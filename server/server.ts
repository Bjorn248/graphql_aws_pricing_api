import * as express from 'express';
import * as graphqlHTTP from 'express-graphql';
import { createPool, format } from 'promise-mysql';
import {
  GraphQLObjectType,
  GraphQLString,
  GraphQLSchema,
  GraphQLList,
} from 'graphql';
import * as getenv from 'getenv';

// TODO Figure out why this uses such an insane amount of memory...

const mariaDBHost = getenv('MARIADB_HOST', 'localhost');
const mariaDBUser = getenv('MARIADB_USER', 'pricer');
const mariaDBPass = getenv('MARIADB_PASSWORD', 'prices123');
const mariaDBName = getenv('MARIADB_DB', 'aws_prices');

const GraphQLObjectMap = {};
const GraphQLQueryMap = {};

export const generateResolveFunction = fieldName => parentValue =>
  parentValue[fieldName];

export const generateQueryFunction = (pool, tableName) => (
  _,
  args,
  __,
  query,
) => {
  const selectionColumns = query.fieldNodes[0].selectionSet.selections.map(
    selection => selection.name.value,
  );

  let queryString;
  if (typeof selectionColumns[0] === 'undefined') {
    queryString = 'SELECT * FROM ?';
  } else {
    queryString = 'SELECT ?? FROM ??';
  }

  const queryIdentifiers = [];
  queryIdentifiers.push(tableName);
  if (Object.keys(args).length !== 0) {
    queryString += ' WHERE ';
    Object.keys(args).forEach(function(arg, index) {
      if (index > 0) {
        queryString += ' AND ';
      }
      queryString += '?? = ?';
      queryIdentifiers.push(arg);
      queryIdentifiers.push(args[arg]);
    });
  }

  queryIdentifiers.unshift(selectionColumns);
  queryString = format(queryString, queryIdentifiers);
  return pool.query(queryString);
};

export const generateFieldFunction = FieldMap => () => FieldMap;

export const generateRootQueryObject = (pool, GraphQLObjectMap) => {
  const returnObject = {};
  Object.keys(GraphQLObjectMap).forEach(tableName => {
    returnObject[tableName] = {
      type: new GraphQLList(GraphQLQueryMap[tableName]),
      args: GraphQLObjectMap[tableName],
      resolve: generateQueryFunction(pool, tableName),
    };
  });
  return () => returnObject;
};

export const getTables = async (pool, GraphQLObjectMap) => {
  const connection = await pool.getConnection();
  const tables = await connection.query('SHOW TABLES');

  const keyName = `Tables_in_${mariaDBName}`;

  tables.forEach(table => {
    GraphQLObjectMap[table[keyName]] = {};
  });

  pool.releaseConnection(connection);
  return GraphQLObjectMap;
};

export const getColumns = async (pool, GraphQLObjectMap) => {
  const connection = await pool.getConnection();
  const queries = Object.keys(GraphQLObjectMap).map(async tableName => {
    // FIXME injection vulnerability
    const rows = await connection.query('SHOW COLUMNS FROM ' + tableName);

    rows.forEach(row => {
      GraphQLObjectMap[tableName][row.Field] = {
        type: GraphQLString,
        resolve: generateQueryFunction(pool, row.Field),
      };
    });
  });

  await Promise.all(queries);
  pool.releaseConnection(connection);

  return GraphQLObjectMap;
};

export const generateQueryMap = (GraphQLObjectMap, GraphQLQueryMap) => {
  Object.keys(GraphQLObjectMap).forEach(tableName => {
    GraphQLQueryMap[tableName] = new GraphQLObjectType({
      name: tableName,
      // helpful
      description: 'None',
      fields: generateFieldFunction(GraphQLObjectMap[tableName]),
    });
  });

  return [GraphQLObjectMap, GraphQLQueryMap];
};

export const run = async () => {
  try {
    const pool = await createPool({
      connectionLimit: 50,
      host: mariaDBHost,
      user: mariaDBUser,
      password: mariaDBPass,
      database: mariaDBName,
    });

    const app = express();

    const tablePopulatedGraphQLObjectMap = await getTables(
      pool,
      GraphQLObjectMap,
    );
    const columnPopulatedGraphQLObjectMap = await getColumns(
      pool,
      tablePopulatedGraphQLObjectMap,
    );
    const [completeGraphQLObjectMap] = generateQueryMap(
      columnPopulatedGraphQLObjectMap,
      GraphQLQueryMap,
    );

    const query = new GraphQLObjectType({
      name: 'Query',
      description: 'Root query object',
      fields: generateRootQueryObject(pool, completeGraphQLObjectMap),
    });

    const schema = new GraphQLSchema({ query });

    app.use(
      '/graphql',
      graphqlHTTP({
        schema,
        pretty: true,
        graphiql: 'production' !== process.env.NODE_ENV,
      }),
    );

    app.listen(4001);
    console.log(
      'Running a GraphQL API server at http://localhost:4001/graphql',
    );
  } catch (err) {
    console.error('Initialization error');
    console.error(err);
    process.exit(1);
  }
};

if (require.main === module) {
  run();
}
