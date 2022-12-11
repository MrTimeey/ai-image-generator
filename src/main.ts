import config from './common/appConfig';
import express from 'express';
import cors from 'cors';
/*import apiDoc from './routes/apiDoc';
import swaggerUi from 'swagger-ui-express';
import swaggerDocument from '../api-doc/openapi.json';*/
import openAi from './routes/openAi';

const app: express.Application = express();

app.use(cors());
app.use(express.json());

const apiRouter: express.Router = express.Router();
apiRouter.use('/openai', openAi);

app.use('/api', apiRouter);
/*app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerDocument, { explorer: false }));
app.use('/doc', apiDoc);*/

app.listen(config.port, () => {
    console.log(`it's alive on http://localhost:${config.port}`);
});
