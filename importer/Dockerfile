FROM python

ADD https://raw.githubusercontent.com/Bjorn248/aws_pricing_data_ingestor/master/pricing_import.py /scripts/
ADD https://raw.githubusercontent.com/Bjorn248/aws_pricing_data_ingestor/master/local_pricing_import.py /scripts/
ADD https://raw.githubusercontent.com/Bjorn248/aws_pricing_data_ingestor/master/requirements.txt /scripts/

RUN chmod +x /scripts/local_pricing_import.py

ADD wait-for /scripts/

RUN pip install -r /scripts/requirements.txt
