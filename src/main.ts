import config from './common/appConfig';
import express from 'express';
import cors from 'cors';
import openAi from './routes/openAi';
import * as path from 'path';

const app: express.Application = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const apiRouter: express.Router = express.Router();
apiRouter.use('/openai', openAi);

app.use('/api', apiRouter);

app.use(express.static(path.join(__dirname, 'static')));

app.listen(config.port, () => {
    console.log(`it's alive on http://localhost:${config.port}`);
});
