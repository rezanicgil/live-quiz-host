// Sunucu varsayılan olarak yalnız bu bilgisayarı dinler. LAN=1 ile ev ağına açıldığında ağdaki bir cihaz yalnız sahneyi
// izleyebilir; panel ve bütün komutlar bu bilgisayarda kalır (denetim server.js içinde bu işlevle yapılır).
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** İstek bu bilgisayardan mı geliyor? */
export const isLocal = (address) => LOCAL.has(String(address || ''));
