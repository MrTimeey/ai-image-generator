import config from './common/appConfig';
import express from 'express';
import cors from 'cors';
import openAi from './routes/openAi';
import * as path from 'path';
import { cleanDataStore } from './common/dataStore';
import thumbnails from './routes/thumbnails';
import files from './routes/files';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import auth from './routes/auth';
import { verifyAuth } from './common/authUtils';
import appConfig from './common/appConfig';
import exchange from './routes/exchange';

const app: express.Application = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(bodyParser.json());
app.use(cookieParser());
if (appConfig.enableAuth) {
    app.use(verifyAuth);
}


const apiRouter: express.Router = express.Router();
apiRouter.use('/openai', openAi);
apiRouter.use('/thumbnails', thumbnails);
apiRouter.use('/files', files);
apiRouter.use('/exchange', exchange);

app.use('/api', apiRouter);
app.use('/login', auth)
app.use('/thumbnails', thumbnails);
app.use(express.static(path.join(__dirname, 'static')));

app.use((_, res) => {
    res.redirect('/notFound.html');
});

app.listen(config.port, () => {
    cleanDataStore();
    console.log(`it's alive on http://localhost:${config.port}`);
});
