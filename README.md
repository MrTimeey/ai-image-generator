# ai-image-generator

Simple project to get in touch with [OpenAI's DALL·E API](https://openai.com/api/) and [Black Forest Labs FLUX 1.1 PRO API](https://docs.bfl.ml/) to generate images from text inputs.

<img src='./doc/title-image.png' width='500'>
Mit KI erstellt ∙ 18. September 2024 um 3:59 PM

## Preconditions

### Account OpenAI
 
You need to create an account for https://openai.com/api/ in order to bring this code alive.
OpenAI provides an amount of free tier to get in touch with the api, so you don't have to spend money in the first place.

### Account Black Forest Labs
 
You need to create an account for https://api.bfl.ml in order to bring this code alive.
BFL provides an amount of free tier to get in touch with the api, so you don't have to spend money in the first place.
API-Key creation is documented here: https://docs.bfl.ml/quick_start/create_account/.

### Environments

Create `.env` from `.env.example`.

## Execution

There are different ways to start the application. After start up it will be available on http://localhost:8080.

### Dev-Mode

```shell
npm install
npm run dev
```

### Service

```shell
npm install
npm run serve
```

### Docker

```shell
docker compose up -d --force-recreate --build
```
