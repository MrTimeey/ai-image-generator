import config from './common/appConfig';
import express from 'express';
import cors from 'cors';
import openAi from './routes/openAi';
import * as path from 'path';
import apiDoc from './routes/apiDoc';
import swaggerUi from 'swagger-ui-express';
import swaggerDocument from '../api-doc/openapi.json';

const app: express.Application = express();

app.use(cors());
app.use(express.json());

const apiRouter: express.Router = express.Router();
apiRouter.use('/openai', openAi);
apiRouter.use('/doc', apiDoc);

app.use('/api', apiRouter);
app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerDocument, { explorer: false }));

app.use(express.static(path.join(__dirname, 'static')));

app.listen(config.port, () => {
    console.log(`it's alive on http://localhost:${config.port}`);
});
