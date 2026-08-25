import OpenAI, { toFile } from 'openai';
import appConfig from '../common/appConfig';
import { OutputFormat, ProviderImage, Quality } from '../types';
import { ModelDefinition, openAiCost } from './modelRegistry';
import { ResolvedSize } from '../common/aspectRatio';
import { ProviderError } from '../common/providerError';
import { InputImage } from '../common/inputImage';

let client: OpenAI | null = null;

const openAiClient = (): OpenAI => {
    if (!appConfig.openai.apiKey) {
        throw new ProviderError(503, 'openai_not_configured', 'Es ist kein OpenAI-Schlüssel hinterlegt.');
    }
    // Die Organisation nur mitschicken, wenn sie gesetzt ist: eine falsche
    // fuehrt zu 401 `mismatched_organization` auf jedem einzelnen Aufruf.
    client ??= new OpenAI({
        apiKey: appConfig.openai.apiKey,
        ...(appConfig.openai.organization ? { organization: appConfig.openai.organization } : {}),
    });
    return client;
};

export const generateImages = async (
    prompt: string,
    model: ModelDefinition,
    size: ResolvedSize,
    quality: Quality,
    format: OutputFormat,
    amount: number,
    inputImages: InputImage[] = []
): Promise<ProviderImage[]> => {
    try {
        const common = {
            model: model.endpoint,
            prompt,
            n: amount,
            // `size` ist bei den festen Modellen einer von drei Werten, bei
            // gpt-image-2 eine freie Größe mit Kanten als Vielfache von 16.
            size: size.size,
            /**
             * `max` ist unser Begriff für „so groß, wie das Modell kann" — die
             * API kennt ihn nicht. Dort steuert `size` die Auflösung, `quality`
             * nur den Rechenaufwand; also die höchste Stufe, die es gibt.
             */
            quality: quality === 'max' ? 'high' : quality,
            output_format: format,
            // Bewusst **kein** `response_format`: die gpt-image-Familie lehnt
            // das Feld ab und liefert immer `b64_json`.
        };

        /**
         * Mit Referenzbildern ist es ein anderer Endpunkt: `images.edit`
         * (`/v1/images/edits`) statt `images.generate`. Die Bilder gehen dort
         * als Multipart-Feld `image[]` mit.
         */
        const response = inputImages.length
            ? await openAiClient().images.edit({
                  ...common,
                  image: await Promise.all(
                      inputImages.slice(0, model.maxInputImages).map((image, index) =>
                          toFile(image.buffer, `referenz-${index + 1}.${image.mimeType.split('/')[1]}`, {
                              type: image.mimeType,
                          })
                      )
                  ),
              })
            : await openAiClient().images.generate(common);

        const data = response.data ?? [];

        /**
         * Die Antwort schlüsselt die Tokens genau auf — damit ist der Betrag
         * gerechnet, nicht geschätzt. Er gilt für den **ganzen Aufruf**, also
         * für alle `n` Bilder zusammen; aufgeteilt wird gleichmäßig, denn
         * feiner gibt OpenAI es nicht her.
         */
        const usage = response.usage;
        const gesamt = usage
            ? openAiCost(model.endpoint, {
                  textInput: usage.input_tokens_details?.text_tokens ?? usage.input_tokens ?? 0,
                  imageInput: usage.input_tokens_details?.image_tokens ?? 0,
                  imageOutput: usage.output_tokens_details?.image_tokens ?? usage.output_tokens ?? 0,
              })
            : null;

        const images = data
            .filter(item => Boolean(item.b64_json))
            .map(item => ({
                buffer: Buffer.from(item.b64_json as string, 'base64'),
                revisedPrompt: item.revised_prompt,
            }));

        const proBild = gesamt !== null && images.length > 0 ? gesamt / images.length : null;
        if (proBild !== null) {
            for (const image of images) {
                (image as { cost?: { amount: number; unit: 'usd' } }).cost = {
                    amount: Math.round(proBild * 10_000) / 10_000,
                    unit: 'usd',
                };
            }
        }

        if (images.length === 0) {
            throw new ProviderError(502, 'openai_empty_response', 'OpenAI hat kein Bild zurückgegeben.');
        }
        return images;
    } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (error instanceof OpenAI.APIError) {
            // `error.code` ist z. B. `invalid_value`, `billing_hard_limit_reached`
            // oder `content_policy_violation` — genau das, was der Nutzer sehen muss.
            throw new ProviderError(
                error.status ?? 502,
                String(error.code ?? 'openai_error'),
                error.message
            );
        }
        throw new ProviderError(502, 'openai_error', error instanceof Error ? error.message : String(error));
    }
};
