// scraper.js - Con API de Mercado Libre y sin SP Digital
const puppeteer = require('puppeteer');
const fs = require('fs');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const urls = [
  {
    tienda: "Mercado Libre",
    // Usando la API oficial de Mercado Libre
    esAPI: true,
    itemId: "MLCU3244552173", // ID del producto
  },
  {
    tienda: "Tecnomas",
    url: "https://www.tecnomas.cl/producto/cpu-amd-ryzen-5-9600x-3-90-5-40ghz-32mb-l3-6-nucleos-skt-am5-c-grf-sinfan",
    selectorPrecio: "#webpay-price-80544",
    selector_disponible: ".single_add_to_cart_button",
  },
  {
    tienda: "MegaDrive Store",
    url: "https://megadrivestore.cl/procesadores-amd/685-amd-ryzen-5-9600x-procesador.html",
    selectorPrecio: ".current-price-display",
    selector_disponible: ".add-to-cart",
    tomarSegundoPrecio: true,
  },
  {
    tienda: "Trulu Store",
    url: "https://trulustore.cl/producto/procesador-amd-ryzen-5-9600x-socket-am5/",
    selectorPrecio: ".ww-price",
    selector_disponible: ".single_add_to_cart_button",
    tomarSegundoPrecio: true,
  },
  {
    tienda: "Winpy",
    url: "https://www.winpy.cl/venta/procesador-amd-ryzen-5-9600x-am5-6-cores-12-hilos-3-9-5-4ghz-32mb-cache-unlocked/",
    selectorPrecio: ".price-normal",
    selector_disponible: ".add-to-cart-button",
  },
  {
    tienda: "Central Gamer",
    url: "https://centralgamer.cl/procesadores/procesador-amd-ryzen-5-9600x-2/",
    selectorPrecio: ".precio-tarjeta-valor",
    selector_disponible: ".single_add_to_cart_button",
  },
  {
    tienda: "MyShop",
    url: "https://www.myshop.cl/producto/procesador-amd-ryzen-5-9600x-6-core-39-ghz-am5-p31008",
    selectorPrecio: ".main-price",
    selector_disponible: ".add-to-cart",
    tomarSegundoPrecio: true,
  },
  // SP Digital comentado porque Cloudflare bloquea siempre
  // {
  //   tienda: "SP Digital",
  //   url: "https://www.spdigital.cl/amd-ryzen-5-9600x-6-core-processor/",
  //   selectorPrecio: null,
  //   selector_disponible: "button[class*='add-to-cart']",
  //   esperaExtra: 12000,
  // },
];

function limpiarPrecio(text) {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9]/g, '');
  const precio = parseInt(cleaned);
  return isNaN(precio) ? null : precio;
}

async function verificarDisponibilidad(page, selector_disponible) {
  try {
    if (selector_disponible) {
      const resultado = await page.evaluate((selector) => {
        const elemento = document.querySelector(selector);
        if (!elemento) return { existe: false };
        
        const disabled = elemento.disabled || 
                        elemento.getAttribute('disabled') !== null ||
                        elemento.classList.contains('disabled') ||
                        elemento.classList.contains('out-of-stock');
        
        return {
          existe: true,
          disabled,
          visible: elemento.offsetParent !== null
        };
      }, selector_disponible);
      
      if (resultado.existe && resultado.visible && !resultado.disabled) {
        return true;
      }
    }
    
    const hayTextoAgotado = await page.evaluate(() => {
      const texto = document.body.innerText.toLowerCase();
      return texto.includes('agotado') || 
             texto.includes('sin stock') || 
             texto.includes('out of stock');
    });
    
    if (hayTextoAgotado) return false;
    
    const hayBotonCompra = await page.evaluate(() => {
      const botones = Array.from(document.querySelectorAll('button, a, input[type="submit"]'));
      return botones.some(btn => {
        const texto = (btn.innerText || btn.value || '').toLowerCase();
        const classes = btn.className.toLowerCase();
        
        const esBotonCompra = texto.includes('agregar') || 
                             texto.includes('añadir') || 
                             texto.includes('comprar') ||
                             classes.includes('add-to-cart');
        
        const noEstaDeshabilitado = !btn.disabled && 
                                   btn.getAttribute('disabled') === null &&
                                   btn.offsetParent !== null;
        
        return esBotonCompra && noEstaDeshabilitado;
      });
    });
    
    return hayBotonCompra;
    
  } catch (error) {
    return null;
  }
}

// Función para obtener datos de Mercado Libre vía API
async function obtenerDatosMercadoLibre(itemId) {
  try {
    console.log(`   🔍 Consultando API de Mercado Libre...`);
    
    const response = await fetch(`https://api.mercadolibre.com/items/${itemId}`);
    
    if (!response.ok) {
      console.log(`   ❌ Error API: ${response.status}`);
      return { precio: null, disponible: null, url: `https://www.mercadolibre.cl/p/${itemId}` };
    }
    
    const data = await response.json();
    
    const precio = data.price || null;
    const disponible = data.status === 'active' && 
                      data.available_quantity > 0 &&
                      !data.sold_out;
    const url = data.permalink || `https://www.mercadolibre.cl/p/${itemId}`;
    
    console.log(`   💰 Precio: $${precio?.toLocaleString('es-CL') || 'N/A'}`);
    console.log(`   📦 Stock: ${data.available_quantity || 0} unidades`);
    console.log(`   ✅ Disponible: ${disponible ? 'Sí' : 'No'}`);
    
    return { precio, disponible, url };
    
  } catch (error) {
    console.error(`   ❌ Error consultando API: ${error.message}`);
    return { precio: null, disponible: null, url: `https://www.mercadolibre.cl/p/${itemId}` };
  }
}

async function enviarTelegram(mensaje) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('⚠️ Telegram no configurado');
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: mensaje,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });

    if (response.ok) {
      console.log('✅ Mensaje enviado a Telegram');
    } else {
      console.error('❌ Error Telegram:', await response.text());
    }
  } catch (error) {
    console.error('❌ Error enviando a Telegram:', error.message);
  }
}

function cargarHistorial() {
  try {
    if (fs.existsSync('results.json')) {
      return JSON.parse(fs.readFileSync('results.json', 'utf8'));
    }
  } catch (error) {
    console.log('No hay historial previo');
  }
  return null;
}

function guardarResultados(datos) {
  fs.writeFileSync('results.json', JSON.stringify(datos, null, 2));
}

function compararPrecios(actual, anterior) {
  if (!anterior || !anterior.resultados) {
    return {
      hayBajadas: false,
      cambios: [],
      mensaje: '🆕 Primera ejecución - sin comparación previa'
    };
  }

  const cambios = [];
  let hayBajadas = false;

  for (const tiendaActual of actual.resultados) {
    const tiendaAnterior = anterior.resultados.find(t => t.tienda === tiendaActual.tienda);
    
    if (tiendaAnterior && tiendaActual.precio && tiendaAnterior.precio) {
      const diferencia = tiendaActual.precio - tiendaAnterior.precio;
      
      if (diferencia < 0) {
        hayBajadas = true;
        cambios.push({
          tienda: tiendaActual.tienda,
          tipo: 'bajada',
          precioAnterior: tiendaAnterior.precio,
          precioActual: tiendaActual.precio,
          ahorro: Math.abs(diferencia),
          disponible: tiendaActual.disponible
        });
      } else if (diferencia > 0) {
        cambios.push({
          tienda: tiendaActual.tienda,
          tipo: 'subida',
          precioAnterior: tiendaAnterior.precio,
          precioActual: tiendaActual.precio,
          aumento: diferencia,
          disponible: tiendaActual.disponible
        });
      }
    }
  }

  return { hayBajadas, cambios };
}

function generarMensaje(datos, comparacion) {
  let mensaje = '';
  
  if (comparacion.hayBajadas) {
    mensaje += '🎉 <b>¡HAY BAJADAS DE PRECIO!</b> 🎉\n\n';
  } else {
    mensaje += '📊 <b>Actualización de Precios</b>\n\n';
  }

  const bajadas = comparacion.cambios.filter(c => c.tipo === 'bajada');
  if (bajadas.length > 0) {
    mensaje += '💸 <b>BAJADAS:</b>\n';
    for (const cambio of bajadas) {
      const stockIcon = cambio.disponible ? '✅' : '❌';
      mensaje += `• ${cambio.tienda} ${stockIcon}\n`;
      mensaje += `  Antes: $${cambio.precioAnterior.toLocaleString('es-CL')}\n`;
      mensaje += `  Ahora: $${cambio.precioActual.toLocaleString('es-CL')}\n`;
      mensaje += `  Ahorro: $${cambio.ahorro.toLocaleString('es-CL')}\n\n`;
    }
    mensaje += '━━━━━━━━━━━━━━━━━\n\n';
  }

  const conStock = datos.resultados
    .filter(r => r.precio && r.disponible)
    .sort((a, b) => a.precio - b.precio);
  
  const sinStock = datos.resultados
    .filter(r => r.precio && !r.disponible)
    .sort((a, b) => a.precio - b.precio);

  const top3 = conStock.length >= 3 
    ? conStock.slice(0, 3)
    : [...conStock, ...sinStock.slice(0, 3 - conStock.length)];

  mensaje += '🏆 <b>TOP 3 MEJORES PRECIOS:</b>\n\n';
  top3.forEach((t, i) => {
    const stockIcon = t.disponible ? '✅' : '❌';
    mensaje += `${i + 1}. <b>${t.tienda}</b> ${stockIcon}\n`;
    mensaje += `   💰 $${t.precio.toLocaleString('es-CL')}\n`;
    mensaje += `   🔗 ${t.url}\n\n`;
  });

  mensaje += '━━━━━━━━━━━━━━━━━\n\n';
  mensaje += '📋 <b>TODOS LOS PRECIOS:</b>\n\n';
  
  const todosOrdenados = [...datos.resultados]
    .filter(r => r.precio)
    .sort((a, b) => a.precio - b.precio);

  todosOrdenados.forEach((t, index) => {
    const stockIcon = t.disponible ? '✅' : '❌';
    const numero = `${index + 1}`.padStart(2, ' ');
    mensaje += `${numero}. ${t.tienda} ${stockIcon}\n`;
    mensaje += `    💰 $${t.precio.toLocaleString('es-CL')}\n`;
  });

  const sinPrecio = datos.resultados.filter(r => !r.precio);
  if (sinPrecio.length > 0) {
    mensaje += `\n⚠️ <b>Sin datos:</b>\n`;
    sinPrecio.forEach(t => {
      mensaje += `   • ${t.tienda}\n`;
    });
  }

  mensaje += '\n━━━━━━━━━━━━━━━━━\n\n';

  const totalConStock = conStock.length;
  const totalSinStock = sinStock.length;
  const exitosos = datos.resultados.filter(r => r.precio).length;
  
  mensaje += `📦 ${totalConStock} con stock | ${totalSinStock} sin stock\n`;
  mensaje += `✅ ${exitosos}/${datos.resultados.length} precios obtenidos\n`;
  mensaje += `⏰ ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`;

  return mensaje;
}

async function scrape() {
  console.log('🚀 Iniciando scraper optimizado (API ML + sin SP Digital)...\n');

  let browser;
  let page;
  
  const resultados = [];

  for (const tiendaObj of urls) {
    const { tienda, esAPI, itemId } = tiendaObj;
    console.log(`🛒 ${tienda}...`);
    
    let precio = null;
    let disponible = null;
    let url = tiendaObj.url || '';
    let ok = false;

    // MERCADO LIBRE: Usar API
    if (esAPI && itemId) {
      const datos = await obtenerDatosMercadoLibre(itemId);
      precio = datos.precio;
      disponible = datos.disponible;
      url = datos.url;
      ok = precio !== null;
      
      resultados.push({ tienda, url, precio, disponible, ok });
      continue; // Siguiente tienda
    }

    // RESTO DE TIENDAS: Usar Puppeteer
    try {
      // Inicializar browser solo cuando se necesita
      if (!browser) {
        browser = await puppeteer.launch({
          headless: 'new',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-blink-features=AutomationControlled',
          ],
        });
        
        page = await browser.newPage();
        
        await page.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });
        
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        });
        
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      }

      const { selectorPrecio, selector_disponible, tomarSegundoPrecio, esperaExtra } = tiendaObj;
      
      await page.goto(url, { 
        waitUntil: "networkidle2", 
        timeout: 60000 
      });
      
      const tiempoEspera = esperaExtra || 3000;
      await new Promise(r => setTimeout(r, tiempoEspera));
      
      // Scroll para lazy loading
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 1000));

      // Extraer precio
      if (selectorPrecio) {
        if (tomarSegundoPrecio) {
          precio = await page.evaluate((selector) => {
            const elementos = document.querySelectorAll(selector);
            return elementos.length >= 2 ? elementos[1].innerText : null;
          }, selectorPrecio);
        } else {
          precio = await page.$eval(selectorPrecio, el => el.innerText).catch(() => null);
        }
        precio = limpiarPrecio(precio);
      }

      disponible = await verificarDisponibilidad(page, selector_disponible);
      ok = precio !== null;
      
      const icon = disponible ? '✅' : '❌';
      console.log(`   💰 $${precio?.toLocaleString('es-CL') || 'N/A'} ${icon}`);
      
    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
    }

    resultados.push({ tienda, url, precio, disponible, ok });
  }

  if (browser) {
    await browser.close();
  }

  const datos = {
    timestamp: new Date().toISOString(),
    resultados,
    exitosos: resultados.filter(r => r.ok).length
  };

  const historial = cargarHistorial();
  const comparacion = compararPrecios(datos, historial);
  
  guardarResultados(datos);

  const mensaje = generarMensaje(datos, comparacion);
  console.log('\n📱 Enviando a Telegram...\n');
  await enviarTelegram(mensaje);

  console.log(`\n✅ Completado: ${datos.exitosos}/${resultados.length} exitosos`);
}

scrape()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  });
