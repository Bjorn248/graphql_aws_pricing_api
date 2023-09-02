FROM python

ADD https://raw.githubusercontent.com/Bjorn248/aws_pricing_data_ingestor/main/pricing_import.py /scripts/
ADD https://raw.githubusercontent.com/Bjorn248/aws_pricing_data_ingestor/main/local_pricing_import.py /scripts/
ADD https://raw.githubusercontent.com/Bjorn248/aws_pricing_data_ingestor/main/Pipfile /scripts/

RUN chmod +x /scripts/local_pricing_import.py

ADD wait-for /scripts/

RUN pip install requests pymysql
