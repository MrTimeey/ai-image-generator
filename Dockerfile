# Node 22: sharp und die aktuellen SDKs setzen es voraus, und der dynamische
# Import von openid-client (ESM) laeuft hier zuverlaessig.
FROM node:22-alpine
# ffmpeg zieht aus jedem Video ein Standbild — ohne das zeigen Raster und
# iPhone nur schwarze Flaechen, bis man auf Play drueckt.
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json /app/package.json
COPY package-lock.json /app/package-lock.json
RUN npm ci
COPY . ./

EXPOSE 3000
CMD ["npm", "run", "serve"]
