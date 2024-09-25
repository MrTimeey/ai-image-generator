import express from 'express';
import jwt from 'jsonwebtoken';
import appConfig from '../common/appConfig';

const auth: express.Router = express.Router();

auth.post('/', (req, res) => {
    const { username: inputUsername, password: inputPassword } = req.body;
    if (inputUsername === appConfig.auth.user && inputPassword === appConfig.auth.pass) {
        const token = jwt.sign({ username: inputUsername }, appConfig.auth.jwtSecret, { expiresIn: '1w' });
        res.cookie('token', token, { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 });
        return res.status(200).send('Login erfolgreich');
    }
    return res.status(401).send('Ungültige Anmeldedaten');
});

export default auth;
