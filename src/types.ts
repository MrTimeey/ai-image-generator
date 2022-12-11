export type ApplicationConfig = {
    port: number;
    apiKey: string;
    organization: string;
};

export enum ImageSize {
    SMALL = '256x256',
    MEDIUM = '512x512',
    LARGE = '1024x1024',
}

export type GeneratedImages = {
    createdAt: string;
    description: string;
    urls: string[];
};

export type GenerateImagesRequest = {
    description: string;
    amount?: number;
    size?: 'SMALL' | 'MEDIUM' | 'LARGE';
};
