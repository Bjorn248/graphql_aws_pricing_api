var express = require('express')
var async = require('async')
var mysql = require('mysql')
var mysqlPromise = require('promise-mysql')
var graphqlHTTP = require('express-graphql')
var {
  GraphQLObjectType,
  GraphQLString,
  GraphQLList,
  GraphQLSchema
} = require('graphql')

var app = express()

// TODO Figure out why this uses such an insane amount of memory...

var mariaDBHost = process.env.MARIADB_HOST || 'localhost'
var mariaDBUser = process.env.MARIADB_USER || 'pricer'
var mariaDBPass = process.env.MARIADB_PASSWORD || 'prices123'
var mariaDBName = process.env.MARIADB_DB || 'aws_prices'

var pool = mysql.createPool({
  connectionLimit: 50,
  host: mariaDBHost,
  user: mariaDBUser,
  password: mariaDBPass,
  database: mariaDBName
})

var poolPromise = mysqlPromise.createPool({
  connectionLimit: 50,
  host: mariaDBHost,
  user: mariaDBUser,
  password: mariaDBPass,
  database: mariaDBName
})

//TODO Fix issue with IngestionServiceSnowball, which contains
// column titles that are not valid GraphQL Field Names. They need to be created in the GraphQL
// schema with modified field names e.g. "mapped_" but then linked back to the original in the database
// as part of the resolve function. The current state of the code gets EC2 queries back up, which is
// my main concern.
function generateResolveFunction (fieldName, regex_mapping) {
  if(regex_mapping) {
      return (parentValue, args, request) => {
        return parentValue[regex_mapping]
      }
  } else {
      return (parentValue, args, request) => {
        return parentValue[fieldName]
      }
  }
}

function generateQueryFunction (poolPromise, tableName) {
  return (parentValue, args, request, query) => {
    var selectionColumns = []
    query.fieldNodes[0].selectionSet.selections.forEach(function (selection) {
      selectionColumns.push(selection.name.value)
    })
    var queryString
    if (typeof selectionColumns[0] === 'undefined') {
      queryString = 'SELECT * FROM ?'
    } else {
      queryString = 'SELECT ?? FROM ??'
    }
    var queryIdentifiers = []
    queryIdentifiers.push(tableName)
    if (Object.keys(args).length !== 0) {
      queryString += ' WHERE '
      Object.keys(args).forEach(function (arg, index) {
        if (index > 0) {
          queryString += ' AND '
        }
        queryString += '?? = ?'
        queryIdentifiers.push(arg)
        queryIdentifiers.push(args[arg])
      })
    }
    queryIdentifiers.unshift(selectionColumns)
    queryString = mysql.format(queryString, queryIdentifiers)
    console.log(queryString)
    return poolPromise.query(queryString)
  }
}

function generateFieldFunction (FieldMap) {
  return () => {
    return FieldMap
  }
}

function generateRootQueryObject (GraphQLObjectMap) {
  var returnObject = {}
  Object.keys(GraphQLObjectMap).forEach(function (tableName) {
    returnObject[tableName] = {
      type: new GraphQLList(GraphQLQueryMap[tableName]),
      args: GraphQLObjectMap[tableName],
      resolve: generateQueryFunction(poolPromise, tableName)
    }
  })
  return () => {
    return returnObject
  }
}

function getTables (pool, GraphQLObjectMap, callback) {
  pool.getConnection(function (err, connection) {
    if (err) {
      console.error(err)
    }
    connection.query('SHOW TABLES', function (err, tables, fields) {
      if (err) {
        callback(err)
      }

      var keyName = 'Tables_in_' + mariaDBName

      tables.forEach(function (table) {
        var tableName = table[keyName]
        GraphQLObjectMap[tableName] = {}
      })

      connection.release()
      callback(null, pool, GraphQLObjectMap)
    })
  })
}

function getColumns (pool, GraphQLObjectMap, callback) {
  var graphQLFieldRegex = new RegExp("^[_a-zA-Z][_a-zA-Z0-9]*$");
  pool.getConnection(function (err, connection) {
    if (err) {
      callback(err)
    }
    async.each(Object.keys(GraphQLObjectMap), function (tableName, callb) {
      connection.query('SHOW COLUMNS FROM ' + tableName, function (err, rows, fields) {
        if (err) {
          callb(err)
        }
        rows.forEach(function (row) {
          var fieldName = row.Field
          if(graphQLFieldRegex.test(fieldName)) {
            var regex_mapping = null
            GraphQLObjectMap[tableName][fieldName] = {
              type: GraphQLString,
              resolve: generateResolveFunction(fieldName, regex_mapping)
            }
          } else {
            var regex_mapping = fieldName
            fieldName = "mapped_" + regex_mapping
            GraphQLObjectMap[tableName][fieldName] = {
              type: GraphQLString,
              resolve: generateResolveFunction(fieldName, regex_mapping)
            }
          }
        })
        callb(err)
      })
    }, function (err) {
      connection.release()
      callback(err, GraphQLObjectMap)
    })
  })
}

function generateQueryMap (GraphQLObjectMap, GraphQLQueryMap, callback) {
  async.each(Object.keys(GraphQLObjectMap), function (tableName, callb) {
    GraphQLQueryMap[tableName] = new GraphQLObjectType({
      name: tableName,
      description: 'None',
      fields: generateFieldFunction(GraphQLObjectMap[tableName])
    })
    callb()
  }, function (err) {
    callback(err, GraphQLObjectMap, GraphQLQueryMap)
  })
}

var GraphQLObjectMap = {}
var GraphQLQueryMap = {}

var waterfallTasks = []

waterfallTasks.push(
  function (cb) {
    getTables(pool, GraphQLObjectMap, function (err) {
      if (err) {
        console.error('Error getting tables from mysql')
      }
      cb(err, pool, GraphQLObjectMap)
    })
  }
)

waterfallTasks.push(
  function (pool, GraphQLObjectMap, cb) {
    getColumns(pool, GraphQLObjectMap, function (err, GraphQLObjectMap) {
      if (err) {
        console.error('Error getting columns from mysql')
      }
      cb(err, GraphQLObjectMap)
    })
  }
)

waterfallTasks.push(
  function (GraphQLObjectMap, cb) {
    generateQueryMap(GraphQLObjectMap, GraphQLQueryMap, function (err, GraphQLObjectMap, GraphQLQueryMap) {
      if (err) {
        console.error('Error generating query map')
      }
      cb(err, GraphQLObjectMap, GraphQLQueryMap)
    })
  }
)

async.waterfall(waterfallTasks, function (err, result) {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  pool.end()
  var Query = new GraphQLObjectType({
    name: 'Query',
    description: 'Root query object',
    fields: generateRootQueryObject(GraphQLObjectMap)
  })

  var Schema = new GraphQLSchema({
    query: Query
  })

  app.use('/graphql', graphqlHTTP({
    schema: Schema,
    pretty: true,
    graphiql: process.env.NODE_ENV !== 'production'
  }))
  // For generating the Markdown tables to be included in the README
  if (process.env.GENERATE_MARKDOWN_DOCS == 1) {
    for (var table in GraphQLObjectMap) {
      if (Object.prototype.hasOwnProperty.call(GraphQLObjectMap, table)) {
        console.log('<details>')
        console.log('<summary>', table, '</summary>')
        console.log()
        console.log('Field | Type')
        console.log('----- | ----')
        for (var column in GraphQLObjectMap[table]) {
          if (Object.prototype.hasOwnProperty.call(GraphQLObjectMap[table], column)) {
            console.log(column, ' | ', GraphQLObjectMap[table][column].type)
          }
        }
        console.log('</details>')
      }
    }
    console.log('')
  }
  app.listen(4000)
  console.log('Running a GraphQL API server at http://localhost:4000/graphql')
})
