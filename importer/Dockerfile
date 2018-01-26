FROM python

ADD pricing_import.py /scripts/
ADD requirements.txt /scripts/

ADD wait-for /scripts/

RUN pip install -r /scripts/requirements.txt
