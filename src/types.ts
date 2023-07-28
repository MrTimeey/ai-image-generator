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
    size?: 'SMALL' | 'MEDIUM' | 'LARGE';
}

export type ImageDataStore = {
    entries: number;
    data: {
        id: string;
        url: string;
        fileName?: string;
        createdAt: string;
        description: string;
    }[];
};
