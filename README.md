# graphql_aws_pricing_api
AWS Pricing API. The idea was to use this to power terraform-cashier (my next project).

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
To run this API, make sure you have all environment variables set and have
a target MariaDB database running.

To install any required dependencies please run `yarn install`

Then, simply start the application using `yarn start`

## Usage
GraphiQL is enabled by default. This should be disabled in non-development environments.

An example query string might look like this

```
{
  AmazonEC2(TermType:"OnDemand", Location:"US East (N. Virginia)", OS:"Linux", InstanceType:"t2.small") {
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
       AND `InstanceType` = 't2.small'
       AND `OS` = 'Linux';
```

A full example HTTP request might look like this
```
{
  "query": "{\n  AmazonEC2(TermType:\"OnDemand\", Location:\"US East (N. Virginia)\", OS:\"Linux\", InstanceType:\"t2.small\") {\n    PricePerUnit\n  }\n}",
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
        "PricePerUnit": "0.023"
      }
    ]
  }
}
```
