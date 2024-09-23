import config from './common/appConfig';
import express from 'express';
import cors from 'cors';
import openAi from './routes/openAi';
import * as path from 'path';
import { cleanDataStore } from './common/dataStore';
import thumbnails from './routes/thumbnails';
import files from './routes/files';

const app: express.Application = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const apiRouter: express.Router = express.Router();
apiRouter.use('/openai', openAi);
apiRouter.use('/thumbnails', thumbnails);
apiRouter.use('/files', files);

app.use('/api', apiRouter);

app.use(express.static(path.join(__dirname, 'static')));

app.listen(config.port, () => {
    cleanDataStore();
    console.log(`it's alive on http://localhost:${config.port}`);
});
