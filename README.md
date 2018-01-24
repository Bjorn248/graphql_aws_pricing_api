# graphql_aws_pricing_api
AWS Pricing API. The idea was to use this to power terraform-cashier (my next project).

# Usage of public endpoint

This code is being run on lambda and can be accessed via the following endpoint:
[https://fvaexi95f8.execute-api.us-east-1.amazonaws.com/Dev/graphql/](https://fvaexi95f8.execute-api.us-east-1.amazonaws.com/Dev/graphql/)

Because of the warmup behavior of Lambda, please give the first call some time (usually around 10-15 seconds) to warm-up.

## Usage
An example query string might look like this

```
{
  AmazonEC2(TermType:"OnDemand", Location:"US East (N. Virginia)", OS:"Linux", InstanceType:"m3.medium", Tenancy:"Shared") {
    PricePerUnit
  }
}
```

The SQL equivalent would be
```
SELECT `PricePerUnit`
FROM   `AmazonEC2`
WHERE  `TermType` = 'OnDemand'
       AND `Location` = 'US East (N. Virginia)'
       AND `InstanceType` = 'm3.medium'
       AND `Tenancy` = 'Shared'
       AND `OS` = 'Linux';
```

A full example HTTP POST request might look like this
```
{
  "query": "{\n  AmazonEC2(TermType:\"OnDemand\", Location:\"US East (N. Virginia)\", OS:\"Linux\", InstanceType:\"m3.medium\", Tenancy:\"Shared\") {\n    PricePerUnit\n  }\n}",
  "variables": null,
  "operationName": null
}
```

An example response might look like this
```
{
  "data": {
    "AmazonEC2": [
      {
        "PricePerUnit": "0.067"
      }
    ]
  }
}
```

## Aliases
[GraphQL Aliases](http://graphql.org/learn/queries/#aliases) can be taken advantage of to retreive multiple pieces of pricing data at once.
For example:
```
{"query":"{ t2_xlarge_Shared: AmazonEC2(Location:\"US West (N. California)\", TermType:\"OnDemand\", InstanceType:\"t2.xlarge\", OS:\"Linux\", Tenancy:\"Shared\") {PricePerUnit Unit Currency} t2_medium_Shared: AmazonEC2(Location:\"US West (N. California)\", TermType:\"OnDemand\", InstanceType:\"t2.medium\", OS:\"Linux\", Tenancy:\"Shared\") {PricePerUnit Unit Currency}}","variables":"","operationName":""}
```

The response for the above query should look like this:
```
{
    "data": {
        "t2_xlarge_Shared": [
            {
                "PricePerUnit": "0.2208",
                "Unit": "Hrs",
                "Currency": "USD"
            }
        ],
        "t2_medium_Shared": [
            {
                "PricePerUnit": "0.0552",
                "Unit": "Hrs",
                "Currency": "USD"
            }
        ]
    }
}
```

Here's a working curl you can use to test the above request query
```
curl -H "Content-Type: application/json" -X POST -d '{"query":"{ t2_xlarge_Shared: AmazonEC2(Location:\"US West (N. California)\", TermType:\"OnDemand\", InstanceType:\"t2.xlarge\", OS:\"Linux\", Tenancy:\"Shared\") {PricePerUnit Unit Currency} t2_medium_Shared: AmazonEC2(Location:\"US West (N. California)\", TermType:\"OnDemand\", InstanceType:\"t2.medium\", OS:\"Linux\", Tenancy:\"Shared\") {PricePerUnit Unit Currency}}","variables":"","operationName":""}' https://fvaexi95f8.execute-api.us-east-1.amazonaws.com/Dev/graphql/
```

# Local Development

## Pre-Requisites
In order to run this API, you must first have a MariaDB instance that has been populated using
[this python script](https://github.com/Bjorn248/aws_pricing_data_ingestor). If you have not done so already,
please run this script pointing at your MariaDB instance to populate it.

## Environment Variables
Variable Name | Description
------------ | -------------
MARIADB_HOST | The hostname/ip of your MariaDB Instance (e.g. localhost)
MARIADB_USER | The user with which to authenticate to MariaDB
MARIADB_PASSWORD | The password with which to authenticate to MariaDB
MARIADB_DB | The DB name to connect to (e.g. aws_prices)

## Instructions
To run this API locally, make sure you have all environment variables set and have
a target MariaDB database running.

To install any required dependencies please run `yarn install`

Then, simply start the application using `yarn start`

## GraphQL Data Types
See [SCHEMATA.md](./SCHEMATA.md)

## Local Development with Docker
You can use `docker-compose` to create a local test environment that should
match the deployed environment for the purposes of development and local
testing.

To get started, run `docker-compose up`. This should create the necessary
containers for:

* The database
* The graphqsl server
* The data importer

Once the database is up you can connect to the mariadb cli via:

    docker-compose run db mysql -h db -p'prices123'

Once the database is running, you can do an initial data import or update via:

    docker-compose run importer /scripts/pricing_import.py

Finally, you can run `docker-compose up server` to start the local server.
