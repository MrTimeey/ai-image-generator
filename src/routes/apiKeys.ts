import express from 'express';
import { z } from 'zod';
import { createApiKey, listApiKeys, revokeApiKey } from '../common/apiKeyStore';
import { callerName, requireSession } from '../common/authUtils';

const apiKeys: express.Router = express.Router();

apiKeys.use(requireSession);

apiKeys.get('/', (_req, res) => {
    res.send({ keys: listApiKeys() });
});

const CreateSchema = z.object({ name: z.string().min(1).max(60) });

apiKeys.post('/', (req, res) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).send({ error: 'invalid_request', message: 'Ein Name ist nötig (1–60 Zeichen).' });
    }
    const { record, secret } = createApiKey(parsed.data.name, callerName(req));
    // Der einzige Moment, in dem der Klartext existiert.
    res.status(201).send({ ...record, secret });
});

apiKeys.delete('/:id', (req, res) => {
    const removed = revokeApiKey(req.params.id);
    res.status(removed ? 200 : 404).send({ removed });
});

export default apiKeys;
