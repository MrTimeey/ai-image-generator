/**
 * Ein Anbieterfehler, der bis in die Antwort durchschlagen darf. Vorher wurde
 * jeder Fehler geloggt und verschluckt; in der Oberflaeche kam nur „That image
 * could not be generated" an, egal ob Schluessel, Groesse oder Guthaben schuld
 * war.
 */
export class ProviderError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string
    ) {
        super(message);
        this.name = 'ProviderError';
    }
}

export const describeError = (error: unknown): string => {
    if (error instanceof ProviderError) return `${error.code}: ${error.message}`;
    if (error instanceof Error) return error.message;
    return String(error);
};

export const statusOf = (error: unknown): number =>
    error instanceof ProviderError ? error.status : 502;
