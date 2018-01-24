#!/usr/bin/env python
"""
For downloading data from the AWS pricing API and importing into mysql/mariadb
"""
from __future__ import print_function
import os
import hashlib
import csv
import json
import logging
import requests
import pymysql.cursors

class PricingImporter(object):
    """For importing aws pricing into a database"""
    def __init__(self, column_titles):
        self.column_titles = column_titles
        # Pricing URLs
        self.base_url = "https://pricing.us-east-1.amazonaws.com{}"
        self.offer_index_url = "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json"
        # Retrieve environment variables
        self.mariadb_host = os.getenv('MARIADB_HOST', 'localhost')
        self.mariadb_user = os.getenv('MARIADB_USER', 'pricer')
        self.mariadb_password = os.getenv('MARIADB_PASSWORD', 'prices123')
        self.mariadb_db = os.getenv('MARIADB_DB', 'aws_prices')

    @classmethod
    def _md5(cls, file):
        """Retrieves a md5 of the specified file."""
        hash_md5 = hashlib.md5()
        with open(file, 'rb') as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_md5.update(chunk)
        return hash_md5.hexdigest()

    @classmethod
    def _download_file(cls, target_url, filename):
        """Downloads a file from the specified URL"""
        logging.info('Downloading file from %s...', target_url)
        response = requests.get(target_url, stream=True)

        with open(filename, 'wb') as f:
            f.write(response.content)

    def _parse_csv_schema(self, filename, table_name):
        """Parses a csv into schema"""
        with open(filename, 'r') as f:
            reader = csv.reader(f)
            for row in reader:
                if row[0] == "SKU":
                    schema = self._generate_schema_from_row(row, table_name)
                    return schema
    def _generate_schema_from_row(self, row, table_name):
        """Generate sql statement for schema"""
        logging.info('Generating SQL Schema from CSV...')
        schema_sql = 'create table {}(\n'.format(table_name)
        for column_title in row:
            if column_title in self.column_titles:
                column_name = self.column_titles.get(column_title, {}).get('name', 'PARSING_ERROR')
                column_type = self.column_titles.get(column_title, {}).get('type', 'PARSING_ERROR')
                schema_sql += '{} {},\n'.format(column_name, column_type)
            else:
                schema_sql += ''.join(e for e in column_title if e.isalnum()) + " VARCHAR(200),\n"
        schema_sql = schema_sql[:-2]
        schema_sql += ");\n"
        return schema_sql

    def _download_offer_index_file(self, offer_index_filename):
        """Downloads the offer index file"""
        offer_index_exists = os.path.isfile(offer_index_filename)


        if offer_index_exists:
            resp = requests.head(self.offer_index_url)
            md5_remote = resp.headers['etag'][1:-1]
            if self._md5(offer_index_filename) == md5_remote:
                logging.warning('You already have the latest offer index!')
                return offer_index_exists
        self._download_file(self.offer_index_url, offer_index_filename)
        offer_index_exists = os.path.isfile(offer_index_filename)
        return offer_index_exists

    def load_offer_index(self):
        """Loads the offer index from json file"""
        offer_index_filename = "/tmp/offer_index.json"
        offer_index_exists = self._download_offer_index_file(offer_index_filename)
        if not offer_index_exists:
            raise IOError('Failed to download offer index file!')

        with open(offer_index_filename) as json_data:
            offer_index = json.load(json_data)
        return offer_index

    def download_offer_file(self, offer_code_url):
        """Downloads the offer file"""
        offer_code = offer_code_url.split('/')[4]
        offer_code_url = '{}.csv'.format(offer_code_url[:-5])
        url = self.base_url.format(offer_code_url)
        local_filename = '/tmp/{}.csv'.format(offer_code)

        # Make sure the file does not already exist
        file_exists = os.path.isfile(local_filename)

        if file_exists:
            resp = requests.head(url)
            md5_remote = resp.headers['etag'][1:-1]
            # If we already have the file, compare md5 of local and remote files
            if self._md5(local_filename) == md5_remote:
                logging.warning('You already have the latest csv for %s!  Skipping...', offer_code)
                return file_exists
        self._download_file(url, local_filename)

        # Ensure the file now exists after downloading it
        file_exists = os.path.isfile(local_filename)
        return file_exists

    def import_csv_into_mariadb(self, filename):
        """Imports csv of data into mariadb"""
        table_name = filename[:-4]
        filename = '/tmp/{}'.format(filename)

        schema = self._parse_csv_schema(filename, table_name)

        db = pymysql.connect(host=self.mariadb_host,
                             user=self.mariadb_user,
                             passwd=self.mariadb_password,
                             db=self.mariadb_db,
                             local_infile=1)

        cursor = db.cursor()
        load_data = "LOAD DATA LOCAL INFILE '{}' INTO TABLE {}".format(filename, table_name)
        load_data += """ FIELDS TERMINATED BY ','
            ENCLOSED BY '"'
        LINES TERMINATED BY '\n'
        IGNORE 6 LINES; """

        logging.info('Checking to see if table %s exists...', table_name)
        cursor.execute("SELECT * FROM information_schema.tables WHERE table_schema = '{}' AND table_name = '{}' LIMIT 1;".format(self.mariadb_db, table_name))
        if cursor.fetchone() is not None:
            logging.info('Dropping existing table %s', table_name)
            cursor.execute('DROP TABLE {};'.format(table_name))
        logging.info('Recreating table...')
        cursor.execute(schema)
        logging.info('Loading csv data...')
        cursor.execute(load_data)
        db.commit()
        cursor.close()

    def main(self):
        """Entrypoint function for class...downloads data and imports to mariadb"""
        offer_index = self.load_offer_index()

        filenames = []
        urls = []
        number_of_threads = 0
        for offer, offer_info in offer_index.get('offers', {}).items():
            number_of_threads += 1
            filenames.append('{}.csv'.format(offer))
            urls.append(offer_info.get('currentVersionUrl', 'PARSING_ERROR'))

        for url in urls:
            self.download_offer_file(url)

        for filename in filenames:
            self.import_csv_into_mariadb(filename)

def load_column_titles():
    """Nice place to store this until it can be loaded from a file"""
    #TODO: Import this from a json file instead.
    column_titles = {
        "SKU": {
            "name": "SKU",
            "type": "VARCHAR(17)"
        },
        "OfferTermCode": {
            "name": "OfferTermCode",
            "type": "VARCHAR(10)"
        },
        "RateCode": {
            "name": "RateCode",
            "type": "VARCHAR(38)"
        },
        "TermType": {
            "name": "TermType",
            "type": "VARCHAR(16)"
        },
        "PriceDescription": {
            "name": "PriceDescription",
            "type": "VARCHAR(200)"
        },
        "EffectiveDate": {
            "name": "EffectiveDate",
            "type": "DATE"
        },
        "StartingRange": {
            "name": "StartingRange",
            "type": "VARCHAR(200)"
        },
        "EndingRange": {
            "name": "EndingRange",
            "type": "VARCHAR(200)"
        },
        "Unit": {
            "name": "Unit",
            "type": "VARCHAR(50)"
        },
        "PricePerUnit": {
            "name": "PricePerUnit",
            "type": "DOUBLE"
        },
        "Currency": {
            "name": "Currency",
            "type": "VARCHAR(3)"
        },
        "LeaseContractLength": {
            "name": "LeaseContractLength",
            "type": "VARCHAR(50)"
        },
        "PurchaseOption": {
            "name": "PurchaseOption",
            "type": "VARCHAR(50)"
        },
        "OfferingClass": {
            "name": "OfferingClass",
            "type": "VARCHAR(50)"
        },
        "Product Family": {
            "name": "ProductFamily",
            "type": "VARCHAR(200)"
        },
        "serviceCode": {
            "name": "ServiceCode",
            "type": "VARCHAR(50)"
        },
        "Location": {
            "name": "Location",
            "type": "VARCHAR(50)"
        },
        "Location Type": {
            "name": "LocationType",
            "type": "VARCHAR(50)"
        },
        "Instance Type": {
            "name": "InstanceType",
            "type": "VARCHAR(50)"
        },
        "Current Generation": {
            "name": "CurrentGeneration",
            "type": "VARCHAR(10)"
        },
        "Instance Family": {
            "name": "InstanceFamily",
            "type": "VARCHAR(50)"
        },
        "vCPU": {
            "name": "vCPU",
            "type": "VARCHAR(10)"
        },
        "Physical Processor": {
            "name": "PhysicalProcessor",
            "type": "VARCHAR(50)"
        },
        "Clock Speed": {
            "name": "ClockSpeed",
            "type": "VARCHAR(50)"
        },
        "Memory": {
            "name": "Memory",
            "type": "VARCHAR(50)"
        },
        "Storage": {
            "name": "Storage",
            "type": "VARCHAR(50)"
        },
        "Network Performance": {
            "name": "NetworkPerformance",
            "type": "VARCHAR(50)"
        },
        "Processor Architecture": {
            "name": "ProcessorArchitecture",
            "type": "VARCHAR(20)"
        },
        "Storage Media": {
            "name": "StorageMedia",
            "type": "VARCHAR(15)"
        },
        "Volume Type": {
            "name": "VolumeType",
            "type": "VARCHAR(100)"
        },
        "Max Volume Size": {
            "name": "MaxVolumeSize",
            "type": "VARCHAR(10)"
        },
        "Max IOPS/volume": {
            "name": "MaxIOPSVolume",
            "type": "VARCHAR(40)"
        },
        "Max IOPS Burst Performance": {
            "name": "MaxIOPSBurstPerformance",
            "type": "VARCHAR(40)"
        },
        "Max throughput/volume": {
            "name": "MaxThroughputPerVolume",
            "type": "VARCHAR(30)"
        },
        "Provisioned": {
            "name": "Provisioned",
            "type": "VARCHAR(10)"
        },
        "Tenancy": {
            "name": "Tenancy",
            "type": "VARCHAR(20)"
        },
        "EBS Optimized": {
            "name": "EBSOptimized",
            "type": "VARCHAR(10)"
        },
        "Operating System": {
            "name": "OS",
            "type": "VARCHAR(15)"
        },
        "License Model": {
            "name": "LicenseModel",
            "type": "VARCHAR(50)"
        },
        "Group": {
            "name": "AWSGroup",
            "type": "VARCHAR(300)"
        },
        "Group Description": {
            "name": "AWSGroupDescription",
            "type": "VARCHAR(300)"
        },
        "Transfer Type": {
            "name": "TransferType",
            "type": "VARCHAR(200)"
        },
        "From Location": {
            "name": "FromLocation",
            "type": "VARCHAR(50)"
        },
        "From Location Type": {
            "name": "FromLocationType",
            "type": "VARCHAR(50)"
        },
        "To Location": {
            "name": "ToLocation",
            "type": "VARCHAR(50)"
        },
        "To Location Type": {
            "name": "ToLocationType",
            "type": "VARCHAR(50)"
        },
        "usageType": {
            "name": "UsageType",
            "type": "VARCHAR(50)"
        },
        "operation": {
            "name": "Operation",
            "type": "VARCHAR(50)"
        },
        "Comments": {
            "name": "Comments",
            "type": "VARCHAR(200)"
        },
        "Dedicated EBS Throughput": {
            "name": "DedicatedEBSThroughput",
            "type": "VARCHAR(30)"
        },
        "Enhanced Networking Supported": {
            "name": "EnhancedNetworkingSupported",
            "type": "VARCHAR(10)"
        },
        "GPU": {
            "name": "GPU",
            "type": "VARCHAR(10)"
        },
        "Instance Capacity - 10xlarge": {
            "name": "InstanceCapacity10xLarge",
            "type": "VARCHAR(10)"
        },
        "Instance Capacity - 2xlarge": {
            "name": "InstanceCapacity2xLarge",
            "type": "VARCHAR(10)"
        },
        "Instance Capacity - 4xlarge": {
            "name": "InstanceCapacity4xLarge",
            "type": "VARCHAR(10)"
        },
        "Instance Capacity - 8xlarge": {
            "name": "InstanceCapacity8xLarge",
            "type": "VARCHAR(10)"
        },
        "Instance Capacity - large": {
            "name": "InstanceCapacityLarge",
            "type": "VARCHAR(10)"
        },
        "Instance Capacity - medium": {
            "name": "InstanceCapacityMedium",
            "type": "VARCHAR(10)"
        },
        "Instance Capacity - xlarge": {
            "name": "InstanceCapacityxLarge",
            "type": "VARCHAR(10)"
        },
        "Intel AVX Available": {
            "name": "IntelAVXAvailable",
            "type": "VARCHAR(10)"
        },
        "Intel AVX2 Available": {
            "name": "IntelAVX2Available",
            "type": "VARCHAR(10)"
        },
        "Intel Turbo Available": {
            "name": "IntelTurboAvailable",
            "type": "VARCHAR(10)"
        },
        "Physical Cores": {
            "name": "PhysicalCores",
            "type": "VARCHAR(10)"
        },
        "Pre Installed S/W": {
            "name": "PreInstalledSW",
            "type": "VARCHAR(50)"
        },
        "Processor Features": {
            "name": "ProcessorFeatures",
            "type": "VARCHAR(50)"
        },
        "Sockets": {
            "name": "Sockets",
            "type": "VARCHAR(10)"
        }
    }
    return column_titles

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    COLUMN_TITLES = load_column_titles()
    PRICING_IMPORTER = PricingImporter(COLUMN_TITLES)
    PRICING_IMPORTER.main()
