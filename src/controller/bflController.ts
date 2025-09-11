import { OpenAI } from 'openai';
import appConfig from '../common/appConfig';
import { GeneratedImage, GeneratedImages } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { currentTimestamp } from '../common/timeUtils';
import { getFileName } from '../common/fileUtils';
import { BflLanguageModel, BflOutputFormat, BflRatio } from './bflTypes';
import Image = OpenAI.Image;
import axios, { AxiosError } from 'axios';

const pollInterval = 1000;
const initialWait = 3000;

export const generateImages = async (
    prompt: string,
    languageModel: BflLanguageModel = BflLanguageModel.FLUX_PRO,
    ratio: BflRatio = BflRatio['1x1'],
    outputFormat: BflOutputFormat = BflOutputFormat.PNG,
    amount = 1,
): Promise<GeneratedImages> => {
    try {
        if (amount > 4) amount = 4
        const requests = Array.from({ length: amount }, () =>
            sendRequest(prompt, languageModel, ratio, outputFormat)
        );
        const results = await Promise.allSettled(requests);

        const created = currentTimestamp();
        const images: GeneratedImage[] =
            results
                .filter(r => r.status === "fulfilled" && r.value)
                .map((r: any) => r.value as string)
                .map((u: string) => ({ url: u ?? 'not_found' }))
                .filter((i: Image) => i.url !== 'not_found')
                .map((i: Image) => {
                    const id = uuidv4();
                    return { id: id, url: i.url ?? 'not_found', fileName: getFileName(id, created), engine: 'bfl' };
                }) ?? [];
        return {
            createdAt: created,
            languageModel,
            description: prompt,
            images: images,
        };
    } catch (error: any) {
        if (error.response) {
            console.error(error.response.status, error.response.data);
        } else {
            console.error(error.message);
        }
    }
    return { createdAt: currentTimestamp(), languageModel, description: prompt, images: [] };
};

const sendRequest = async (
    prompt: string,
    model: BflLanguageModel,
    ratio: BflRatio,
    format: BflOutputFormat,
): Promise<string> => {
    try {
        const response = await axios.post(
            `https://api.bfl.ml/v1/${model}`,
            {
                prompt,
                aspect_ratio: ratio,
                output_format: format,
            },
            {
                headers: {
                    accept: "application/json",
                    "x-key": appConfig.bfl.apiKey,
                    "Content-Type": "application/json",
                },
            }
        );

        const requestId = response.data.id as string;
        await sleep(initialWait);
        return await pollForResult(requestId);
    } catch (error: any) {
        console.error(
            "Fehler bei der API-Anfrage:",
            error.response ? error.response.data : error.message
        );
        throw error;
    }
};

export const pollForResult = async (requestId: string): Promise<string> => {
    const pollUrl = `https://api.bfl.ml/v1/get_result?id=${requestId}`;

    let attempt = 0;
    const found = false
    while (!found) {
        try {
            const response = await axios.get(pollUrl, {
                timeout: 10_000,
                headers: {
                    accept: "application/json",
                    "x-key": appConfig.bfl.apiKey,
                },
            });

            const status: string = response.data?.status;

            if (status === "Ready") {
                return response.data?.result?.sample ?? '';
            }

            if (status === "Failed") {
                return Promise.reject(new Error("Bildgenerierung fehlgeschlagen"));
            }

            await sleep(pollInterval);
        } catch (e: any) {
            const err = e as AxiosError;
            const retryable = isRetryableNetworkError(err) || isRetryableHttpStatus(err.response?.status);

            if (!retryable) {
                const detail = err.response?.data ?? err.message;
                throw new Error(`Fehler beim Abrufen des Ergebnisses: ${JSON.stringify(detail)}`);
            }

            if (attempt >= 6) {
                const detail = err.response?.data ?? err.message;
                throw new Error(`Fehler (nach ${attempt} Retries) beim Abrufen des Ergebnisses: ${JSON.stringify(detail)}`);
            }

            await sleep(pollInterval);
            attempt++;
        }
    }
    return Promise.reject('Bildgenerierung fehlgeschlagen')
};

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

const isRetryableNetworkError = (err: AxiosError | any): boolean => {
    const code = (err?.code || "").toString();
    // typische transient network/dns errors aus Node/axios
    return ["EAI_AGAIN", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE"].includes(code);
};

const isRetryableHttpStatus = (status?: number): boolean => {
    if (!status) return false;
    if (status === 429) return true;
    return status >= 500 && status < 600;
};