export type ApplicationConfig = {
    port: number;
    apiKey: string;
    saveImagesEnabled: boolean;
    organization: string;
    baseFolder: string;
    enableAuth: boolean;
    auth: {
        jwtSecret: string;
        user: string;
        pass: string;
    };
};

export enum ImageSize {
    SMALL = '256x256',
    MEDIUM = '512x512',
    LARGE = '1024x1024',
    LARGE_VERTICAL = '1024x1792',
    LARGE_HORIZONTAL = '1792x1024',
}

export enum LanguageModel {
    DALL_E_TWO = 'dall-e-2',
    DALL_E_THREE = 'dall-e-3',
}

export enum Sorting {
    ASCENDING = 'ASC',
    DESCENDING = 'DESC',
}

export enum ImageQuality {
    STANDARD = 'standard',
    HD = 'hd',
}

export type GeneratedImage = {
    id: string;
    url: string;
    fileName: string;
    revisedPrompt: string;
};

export interface GeneratedImages extends BaseImages {
    createdAt: string;
    description: string;
    images: GeneratedImage[];
}

export interface BaseImages {
    createdAt: string;
    languageModel: LanguageModel;
    images: GeneratedImage[];
}

export interface GenerateImagesRequest extends BaseImageRequest {
    description: string;
}

export interface BaseImageRequest {
    amount?: number;
    languageModel?: 'DALL_E_TWO' | 'DALL_E_THREE';
    size?: 'SMALL' | 'MEDIUM' | 'LARGE';
    quality?: 'STANDARD' | 'HD';
}

export type ImageDataStore = {
    entries: number;
    data: DataImage[];
};

export type DataImage = {
    id: string;
    url: string;
    fileName?: string;
    createdAt: string;
    languageModel: LanguageModel;
    description: string;
    revisedPrompt: string;
}
