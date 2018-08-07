import * as getenv from 'getenv';
import { createPool } from 'promise-mysql';
import { getTables, getColumns, generateQueryMap } from './server';

const GraphQLObjectMap = {};
const GraphQLQueryMap = {};

export const run = async () => {
  const pool = await createPool({
    connectionLimit: 50,
    host: getenv('MARIADB_HOST', 'localhost'),
    user: getenv('MARIADB_USER', 'pricer'),
    password: getenv('MARIADB_PASSWORD', 'prices123'),
    database: getenv('MARIADB_DB', 'aws_prices'),
  });

  const tablePopulatedGraphQLObjectMap = await getTables(pool, GraphQLObjectMap);
  const columnPopulatedGraphQLObjectMap = await getColumns(pool, tablePopulatedGraphQLObjectMap);
  const [completeGraphQLObjectMap] = generateQueryMap(columnPopulatedGraphQLObjectMap, GraphQLQueryMap);

  Object.keys(completeGraphQLObjectMap).forEach(table => {
    console.log(`<details>
<summary>${table}</summary>

Field | Type
----- | ----`);

    Object.keys(completeGraphQLObjectMap[table]).forEach(column => {
      console.log(`${column} | ${completeGraphQLObjectMap[table][column].type}`);
    });
    console.log(`</details>`);
    console.log();
  });

  pool.end();
};

if (require.main === module) {
  run();
}
