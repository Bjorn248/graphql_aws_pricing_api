#!/bin/bash

sequelize-auto -o "./models" -d aws_prices -h localhost -u pricer -x prices123 -e mariadb -a sqlauto.json
