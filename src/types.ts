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
};

export type GeneratedImages = {
    createdAt: string;
    description: string;
    urls: ImageUrl[];
};

export type GenerateImagesRequest = {
    description: string;
    amount?: number;
    size?: 'SMALL' | 'MEDIUM' | 'LARGE';
};

export type ImageDataStore = {
    entries: number;
    data: {
        id: string;
        url: string;
        createdAt: string;
        description: string;
    }[];
};
