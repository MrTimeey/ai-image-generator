import { OpenAI } from 'openai';
import appConfig from '../common/appConfig';
import { GeneratedImage, GeneratedImages } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { currentTimestamp } from '../common/timeUtils';
import { getFileName } from '../common/fileUtils';
import { BflLanguageModel, BflOutputFormat, BflRatio } from './bflTypes';
import Image = OpenAI.Image;
import axios from 'axios';

const pollInterval = 500;

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
        const results = await Promise.all(requests);

        const created = currentTimestamp();
        const images: GeneratedImage[] =
            results
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
            console.log(error.response.status, error.response.data);
        } else {
            console.log(error.message);
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
        return await pollForResult(requestId);
    } catch (error: any) {
        console.error(
            "Fehler bei der API-Anfrage:",
            error.response ? error.response.data : error.message
        );
        throw error;
    }
};

const pollForResult = async (requestId: string): Promise<string> => {
    const pollUrl = `https://api.bfl.ml/v1/get_result?id=${requestId}`;

    return new Promise<string>((resolve, reject) => {
        const poll = async () => {
            try {
                const response = await axios.get(pollUrl, {
                    headers: {
                        accept: "application/json",
                        "x-key": appConfig.bfl.apiKey,
                    },
                });

                const status = response.data.status;

                if (status === "Ready") {
                    const resultUrl: string = response.data.result.sample;
                    resolve(resultUrl);
                } else if (status === "Failed") {
                    reject(new Error("Bildgenerierung fehlgeschlagen"));
                } else {
                    setTimeout(poll, pollInterval);
                }
            } catch (error: any) {
                reject(
                    new Error(
                        `Fehler beim Abrufen des Ergebnisses: ${
                            error.response ? error.response.data : error.message
                        }`
                    )
                );
            }
        };

        poll();
    });
};