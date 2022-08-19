FROM node

WORKDIR /usr/src/app

ADD package.json package-lock.json ./
RUN npm i

EXPOSE 4000

CMD ["npx", "pm2", "start", "src/server.js", "--watch", "--no-daemon", "--restart-delay=30000"]
