export const money = (n: number) => new Intl.NumberFormat('zh-CN').format(n);
const colors = ['#337878', '#c78445', '#8470ac', '#a55e71', '#587fbd', '#788e43'];
export const playerColor = (index: number) => colors[index % colors.length];
