export type ApplicationConfig = {
    port: number;
    apiKey: string;
    saveImagesEnabled: boolean;
    organization: string;
    baseFolder: string;
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

export enum ImageQuality {
    STANDARD = 'standard',
    HD = 'hd',
}

export type ImageUrl = {
    id: string;
    url: string;
    fileName: string;
};

export interface GeneratedImages extends BaseImages {
    createdAt: string;
    description: string;
    urls: ImageUrl[];
}

export interface BaseImages {
    createdAt: string;
    urls: ImageUrl[];
}

export interface GenerateImagesRequest extends BaseImageRequest {
    description: string;
}
export interface GenerateAlternativesRequest extends BaseImageRequest {
    baseImage: string;
    originalImageName: string;
}

export interface BaseImageRequest {
    amount?: number;
    languageModel?: 'DALL_E_TWO' | 'DALL_E_THREE';
    size?: 'SMALL' | 'MEDIUM' | 'LARGE';
    quality?: 'STANDARD' | 'HD';
}

export type ImageDataStore = {
    entries: number;
    data: {
        id: string;
        url: string;
        fileName?: string;
        createdAt: string;
        languageModel: LanguageModel;
        description: string;
    }[];
};
