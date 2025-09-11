export enum BflLanguageModel {
    PRO = 'flux-pro-1.1',
    FLUX_MAX = 'flux-kontext-max',
    FLUX_PRO = 'flux-kontext-pro',
}


export const BflRatio = {
    '21x9': '21:9',
    '16x9': '16:9',
    '4x3': '4:3',
    '1x1': '1:1',
    '9x16': '9:16',
    '9x21': '9:21',
} as const

export type BflRatio = typeof BflRatio[keyof typeof BflRatio];

export enum BflOutputFormat {
    PNG = 'png',
    JPEG = 'jpeg',
}