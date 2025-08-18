FROM apify/actor-node:20

COPY package*.json ./
RUN npm install --only=prod

COPY . ./

CMD ["npm", "start"]
