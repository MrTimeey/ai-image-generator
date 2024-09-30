import jwt from 'jsonwebtoken';
import appConfig from './appConfig';
import { Request, Response, NextFunction } from 'express';

export const verifyAuth = (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/login' || req.path === '/login.html' || req.path.includes('/public/')) {
        return next();
    }
    verifyToken(req, res, next);
}

const verifyToken = (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(403).redirect('/login.html');
    }
    jwt.verify(token, appConfig.auth.jwtSecret, (err: unknown, user: any) => {
        if (err) {
            return res.status(403).redirect('/login.html');
        }
        res.locals.user = user;
        next();
    });
};
