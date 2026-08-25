import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import * as path from 'path';
import appConfig from './common/appConfig';
import { cleanDataStore } from './common/dataStore';
import { requireAuth } from './common/authUtils';
import authRoutes from './routes/authRoutes';
import apiKeys from './routes/apiKeys';
import generateRouter from './routes/generate';
import skill from './routes/skill';
import legacy from './routes/legacy';
import thumbnails from './routes/thumbnails';
import images from './routes/images';
import files from './routes/files';
import exchange from './routes/exchange';

const app: express.Application = express();

app.disable('x-powered-by');
// Bewusst gesetzt statt Standard-`*`: die Anwendung haengt sonst komplett
// hinter OIDC, und ein offener Default gehoert nicht dazu.
app.use(cors({ origin: appConfig.publicBaseUrl }));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// Frei erreichbar und bewusst vor dem Tor: Skripte sollen einen Ausfall von
// einem Anmeldefehler unterscheiden koennen.
app.get('/api/health', (_req, res) => {
    res.send({ status: 'ok', authEnabled: appConfig.enableAuth });
});

app.use('/auth', authRoutes);

if (appConfig.enableAuth) {
    app.use(requireAuth);
}

const apiRouter: express.Router = express.Router();
apiRouter.use(generateRouter);
apiRouter.use(legacy);
apiRouter.use('/keys', apiKeys);
apiRouter.use('/skill', skill);
apiRouter.use('/images', images);
apiRouter.use('/thumbnails', thumbnails);
apiRouter.use('/files', files);
apiRouter.use('/exchange', exchange);

app.use('/api', apiRouter);
app.use('/thumbnails', thumbnails);
app.use(express.static(path.join(__dirname, 'static')));

/**
 * Letztes Netz für async-Handler: Express 4 leitet eine abgelehnte Promise
 * **nicht** an die Fehlerbehandlung weiter, sie wird zur unbehandelten
 * Rejection und beendet den Prozess. Ein einziges unlesbares Bild hat so den
 * ganzen Dienst gekostet.
 */
process.on('unhandledRejection', reason => {
    console.error('Unbehandelte Rejection — der Dienst laeuft weiter:', reason);
});

app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).send({ error: 'not_found', message: `Unbekannter Endpunkt ${req.path}` });
    }
    res.redirect('/notFound.html');
});

app.listen(appConfig.port, () => {
    cleanDataStore();
    console.log(`it's alive on ${appConfig.publicBaseUrl}`);
});
