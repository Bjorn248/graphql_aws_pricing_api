var express = require('express');
var Sequelize = require('sequelize');
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
var walkSync = require('walk-sync');
var http = require('http');

var app = express();

mariaDBHost = process.env.MARIADB_HOST || "localhost";
mariaDBUser = process.env.MARIADB_USER || "pricer";
mariaDBPass = process.env.MARIADB_PASSWORD || "prices123";
mariaDBName = process.env.MARIADB_DB || "aws_prices";

var sequelize = new Sequelize(mariaDBName, mariaDBUser, mariaDBPass, {
    host: mariaDBHost,
    dialect: 'mariadb',

    pool: {
        max: 5,
        min: 0,
        idle: 10000
    }
});

var sharedVariables = {};

var files = walkSync("./models", { directories: false });
files.forEach(function(file) {
    var tableName = file.split('.')[0];
    console.log("Importing " + file + "...");
    sharedVariables[tableName] = sequelize.import("./models/" + file);
    sharedVariables[tableName].removeAttribute('id');
});


// TODO Make this init all GraphQL Types and Schema

function generateResolveFunction(tableName, fieldName) {
    return (model) => {
        return model[fieldName];
    };
}

function generateQueryFunction(global, tableName) {
    return (global, args) => {
        return sharedVariables[tableName].findAll({ where: args });
    };
}

function generateFieldFunction(FieldMap) {
    return () => {
        return FieldMap;
    };
}

function generateRootQueryObject(GraphQLObjectMap) {
    var returnObject = {};
    for (var tableName in GraphQLObjectMap) {
        returnObject[tableName] = {
            type: new GraphQLList(sharedVariables[tableName + "GraphQL"]),
            args: GraphQLObjectMap[tableName],
            resolve: generateQueryFunction(global, tableName)
        };
    }
    return () => {
        return returnObject;
    };
}

var GraphQLObjectMap = {};
files.forEach(function(file) {
    var tableName = file.split('.')[0];
    GraphQLObjectMap[tableName] = {};
    console.log("Creating GraphQL Types for " + file + "...");
    for (var fieldName in sharedVariables[tableName].attributes) {
        GraphQLObjectMap[tableName][fieldName] = {
            type: GraphQLString,
            resolve: generateResolveFunction(tableName, fieldName)
        };
    }
    sharedVariables[tableName + "GraphQL"] = new GraphQLObjectType({
        name: tableName,
        description: 'None',
        fields: generateFieldFunction(GraphQLObjectMap[tableName])
    });
});

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
