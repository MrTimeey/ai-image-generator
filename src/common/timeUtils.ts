import dayjs from 'dayjs';

export function currentTimestamp() {
    return formatDate(new Date());
}

const formatDate = (date: Date): string => {
    return dayjs(date).format('YYYY-MM-DD_HH-mm');
};
