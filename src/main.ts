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
import jwt from 'jsonwebtoken';

const app: express.Application = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(bodyParser.json());
app.use(cookieParser());

const JWT_SECRET = 'meinSuperGeheimesSchluesselwort';

// Benutzername und Passwort
const username = 'admin';
const password = 'password';

// @ts-ignore
const verifyToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(403).redirect('/login.html');
    }
    // @ts-ignore
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).redirect('/login.html');
        }
        req.user = user;
        next();
    });
};
app.post('/login', (req, res) => {
    const { username: inputUsername, password: inputPassword } = req.body;
    if (inputUsername === username && inputPassword === password) {
        const token = jwt.sign({ username: inputUsername }, JWT_SECRET, { expiresIn: '1h' });
        res.cookie('token', token, { httpOnly: true, maxAge: 3600000 });
        return res.status(200).send('Login erfolgreich');
    }
    return res.status(401).send('Ungültige Anmeldedaten');
});

app.use((req, res, next) => {
    if (req.path === '/login' || req.path === '/login.html') {
        return next();
    }
    verifyToken(req, res, next);
});


const apiRouter: express.Router = express.Router();
apiRouter.use('/openai', openAi);
apiRouter.use('/thumbnails', thumbnails);
app.use('/api', apiRouter);
app.use('/thumbnails', thumbnails);
app.use('/files', files);
app.use(express.static(path.join(__dirname, 'static')));

app.listen(config.port, () => {
    cleanDataStore();
    // clean Thumbnails
    console.log(`it's alive on http://localhost:${config.port}`);
});
