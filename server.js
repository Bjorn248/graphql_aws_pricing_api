var express = require('express');
var async = require('async');
var mysql      = require('mysql');
var mysqlPromise      = require('promise-mysql');
var graphqlHTTP = require('express-graphql');
var {
    buildSchema,
    GraphQLObjectType,
    GraphQLString,
    GraphQLInt,
    GraphQLSchema,
    GraphQLList,
    GraphQLNonNull
} = require('graphql');
var http = require('http');

var app = express();

// TODO Figure out why this uses such an insane amount of memory...

mariaDBHost = process.env.MARIADB_HOST || "localhost";
mariaDBUser = process.env.MARIADB_USER || "pricer";
mariaDBPass = process.env.MARIADB_PASSWORD || "prices123";
mariaDBName = process.env.MARIADB_DB || "aws_prices";

var pool = mysql.createPool({
    connectionLimit : 50,
    host            : mariaDBHost,
    user            : mariaDBUser,
    password        : mariaDBPass,
    database        : mariaDBName
});

var poolPromise = mysqlPromise.createPool({
    connectionLimit : 50,
    host            : mariaDBHost,
    user            : mariaDBUser,
    password        : mariaDBPass,
    database        : mariaDBName
});

function generateResolveFunction(fieldName) {
    return (parentValue, args, request) => {
        return parentValue[fieldName];
    };
}

function generateQueryFunction(poolPromise, tableName) {
    return (parentValue, args, request, query) => {
        var selectionColumns = [];
        query.fieldNodes[0].selectionSet.selections.forEach(function(selection) {
            selectionColumns.push(selection.name.value);
        });
        var queryString;
        if (typeof selectionColumns[0] === 'undefined') {
            queryString = "SELECT * FROM ?";
        } else {
            queryString = "SELECT ?? FROM ??";
        }
        var queryIdentifiers = [];
        queryIdentifiers.push(tableName);
        if (Object.keys(args).length !== 0) {
            queryString += " WHERE ";
            Object.keys(args).forEach(function(arg, index) {
                if (index > 0) {
                    queryString += " AND ";
                }
                queryString += "?? = ?";
                queryIdentifiers.push(arg);
                queryIdentifiers.push(args[arg]);
            });
        }
        queryIdentifiers.unshift(selectionColumns);
        queryString = mysql.format(queryString, queryIdentifiers);
        console.log(queryString);
        return poolPromise.query(queryString);
    };
}

function generateFieldFunction(FieldMap) {
    return () => {
        return FieldMap;
    };
}

function generateRootQueryObject(GraphQLObjectMap) {
    var returnObject = {};
    Object.keys(GraphQLObjectMap).forEach(function(tableName) {
        returnObject[tableName] = {
            type: new GraphQLList(GraphQLQueryMap[tableName]),
            args: GraphQLObjectMap[tableName],
            resolve: generateQueryFunction(poolPromise, tableName)
        };
    });
    return () => {
        return returnObject;
    };
}

function getTables(pool, GraphQLObjectMap, callback) {
    pool.getConnection(function(err, connection) {
        if (err) {
            console.error(err);
        }
        connection.query('SHOW TABLES', function(err, tables, fields) {
            if (err) {
                callback(err);
            }

            var keyName = "Tables_in_" + mariaDBName;

            tables.forEach(function(table) {
                tableName = table[keyName];
                GraphQLObjectMap[tableName] = {};
            });

            connection.release();
            callback(null, pool, GraphQLObjectMap);
        });
    });
}

function getColumns(pool, GraphQLObjectMap, callback) {
    pool.getConnection(function(err, connection) {
        if (err) {
            callback(err);
        }
        async.each(Object.keys(GraphQLObjectMap), function(tableName, callb) {
            connection.query("SHOW COLUMNS FROM " + tableName, function(err, rows, fields) {
                if (err) {
                    callb(err);
                }
                rows.forEach(function(row) {
                    var fieldName = row.Field;
                    GraphQLObjectMap[tableName][fieldName] = {
                        type: GraphQLString,
                        resolve: generateResolveFunction(fieldName)
                    };
                });
                callb(err);
            });
        }, function(err) {
            connection.release();
            callback(err, GraphQLObjectMap);
        });
    });
}

function generateQueryMap(GraphQLObjectMap, GraphQLQueryMap, callback) {
    async.each(Object.keys(GraphQLObjectMap), function(tableName, callb) {
        GraphQLQueryMap[tableName] = new GraphQLObjectType({
            name: tableName,
            description: 'None',
            fields: generateFieldFunction(GraphQLObjectMap[tableName])
        });
        callb();
    }, function(err) {
        callback(err, GraphQLObjectMap, GraphQLQueryMap);
    });
}

var GraphQLObjectMap = {};
var GraphQLQueryMap = {};

waterfallTasks = [];

var waterfallTasks = [];

waterfallTasks.push(
    function(cb) {
        getTables(pool, GraphQLObjectMap, function(err) {
            if (err) {
                console.error("Error getting tables from mysql");
            }
            cb(err, pool, GraphQLObjectMap);
        });
    }
);

waterfallTasks.push(
    function(pool, GraphQLObjectMap, cb) {
        getColumns(pool, GraphQLObjectMap, function(err, GraphQLObjectMap) {
            if (err) {
                console.error("Error getting tables from mysql");
            }
            cb(err, GraphQLObjectMap);
        });
    }
);

waterfallTasks.push(
    function(GraphQLObjectMap, cb) {
        generateQueryMap(GraphQLObjectMap, GraphQLQueryMap, function(err, GraphQLObjectMap, GraphQLQueryMap) {
            if (err) {
                console.error("Error getting tables from mysql");
            }
            cb(err, GraphQLObjectMap, GraphQLQueryMap);
        });
    }
);

async.waterfall(waterfallTasks, function (err, result) {
    pool.end();
    var Query = new GraphQLObjectType({
        name: 'Query',
        description: 'Root query object',
        fields: generateRootQueryObject(GraphQLObjectMap)
    });

    var Schema = new GraphQLSchema({
        query: Query
    });

    app.use('/graphql', graphqlHTTP({
        schema: Schema,
        pretty: true,
        graphiql: true,
    }));
    app.listen(4000);
    console.log('Running a GraphQL API server at localhost:4000/graphql');
});
