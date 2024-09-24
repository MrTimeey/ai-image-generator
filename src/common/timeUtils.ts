import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat)

export const READ_FORMAT = 'DD.MM.YYYY - HH:mm'

export function currentTimestamp() {
    return formatDate(new Date());
}

const formatDate = (date: Date, format = 'YYYY-MM-DD_HH-mm'): string => {
    return dayjs(date).tz('Europe/Berlin').format(format);
};

export const fromFormated = (formattedDate: string, format = 'YYYY-MM-DD_HH-mm') => {
    return dayjs(formattedDate, format);
}
