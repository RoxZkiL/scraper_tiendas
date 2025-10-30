// scraper.js - Versión simplificada para GitHub Actions + Telegram
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const urls = [
  {
    tienda: "Mercado Libre",
    url: "https://www.mercadolibre.cl/procesador-amd-ryzen-5-9600x-am5-39ghz54ghz-/up/MLCU3244552173",
    selectorPrecio: ".andes-money-amount__fraction",
    selector_disponible: ".ui-pdp-buybox__quantity__available",
    tomarSegundoPrecio: false,
    esperaExtra: 4000, // Mercado Libre necesita más tiempo
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
  {
    tienda: "SP Digital",
    url: "https://www.spdigital.cl/amd-ryzen-5-9600x-6-core-processor/",
    selectorPrecio: null,
    selector_disponible: "button[class*='add-to-cart']",
    esperaExtra: 5000, // SP Digital carga con React
  },
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
  
  // Encabezado
  if (comparacion.hayBajadas) {
    mensaje += '🎉 <b>¡HAY BAJADAS DE PRECIO!</b> 🎉\n\n';
  } else {
    mensaje += '📊 <b>Actualización de Precios</b>\n\n';
  }

  // Cambios importantes
  const bajadas = comparacion.cambios.filter(c => c.tipo === 'bajada');
  if (bajadas.length > 0) {
    mensaje += '💸 <b>BAJADAS:</b>\n';
    for (const cambio of bajadas) {
      const stockIcon = cambio.disponible ? '✅' : '❌';
      mensaje += `• ${cambio.tienda} ${stockIcon}\n`;
      mensaje += `  Antes: ${cambio.precioAnterior.toLocaleString('es-CL')}\n`;
      mensaje += `  Ahora: ${cambio.precioActual.toLocaleString('es-CL')}\n`;
      mensaje += `  Ahorro: ${cambio.ahorro.toLocaleString('es-CL')}\n\n`;
    }
    mensaje += '━━━━━━━━━━━━━━━━━\n\n';
  }

  // Top 3 mejores precios
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
    mensaje += `   💰 ${t.precio.toLocaleString('es-CL')}\n`;
    mensaje += `   🔗 ${t.url}\n\n`;
  });

  mensaje += '━━━━━━━━━━━━━━━━━\n\n';

  // NUEVA SECCIÓN: Lista completa de precios
  mensaje += '📋 <b>TODOS LOS PRECIOS:</b>\n\n';
  
  const todosOrdenados = [...datos.resultados]
    .filter(r => r.precio)
    .sort((a, b) => a.precio - b.precio);

  todosOrdenados.forEach((t, index) => {
    const stockIcon = t.disponible ? '✅' : '❌';
    const numero = `${index + 1}`.padStart(2, ' ');
    mensaje += `${numero}. ${t.tienda} ${stockIcon}\n`;
    mensaje += `    💰 ${t.precio.toLocaleString('es-CL')}\n`;
  });

  // Productos sin precio
  const sinPrecio = datos.resultados.filter(r => !r.precio);
  if (sinPrecio.length > 0) {
    mensaje += `\n⚠️ <b>Sin datos:</b>\n`;
    sinPrecio.forEach(t => {
      mensaje += `   • ${t.tienda}\n`;
    });
  }

  mensaje += '\n━━━━━━━━━━━━━━━━━\n\n';

  // Estadísticas
  const totalConStock = conStock.length;
  const totalSinStock = sinStock.length;
  const exitosos = datos.resultados.filter(r => r.precio).length;
  
  mensaje += `📦 ${totalConStock} con stock | ${totalSinStock} sin stock\n`;
  mensaje += `✅ ${exitosos}/${datos.resultados.length} precios obtenidos\n`;
  mensaje += `⏰ ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`;

  return mensaje;
}

async function scrape() {
  console.log('🚀 Iniciando scraper...\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  const resultados = [];

  for (const tiendaObj of urls) {
    const { tienda, url, selectorPrecio, selector_disponible, tomarSegundoPrecio, esperaExtra } = tiendaObj;
    console.log(`🛒 ${tienda}...`);
    
    let precio = null;
    let disponible = null;
    let ok = false;

    try {
      await page.goto(url, { 
        waitUntil: "networkidle2", 
        timeout: 60000 
      });
      
      // Espera base + espera extra si la tiene configurada
      const tiempoEspera = esperaExtra || 3000;
      await new Promise(r => setTimeout(r, tiempoEspera));

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
      } else {
        // SP Digital
        const html = await page.content();
        const match = html.match(/Otros medios de pago<\/span>.*?Fractal-Price--price[^>]*>\$?([\d\.]+)</s);
        if (match) {
          precio = parseInt(match[1].replace(/\./g, ''));
        } else {
          const matches = html.match(/Fractal-Price--price[^>]*>\$?([\d\.]+)/g);
          if (matches && matches.length > 0) {
            const ultimoPrecio = matches[matches.length - 1];
            const valorMatch = ultimoPrecio.match(/\$?([\d\.]+)/);
            if (valorMatch) {
              precio = parseInt(valorMatch[1].replace(/\./g, ''));
            }
          }
        }
      }

      disponible = await verificarDisponibilidad(page, selector_disponible);
      ok = precio !== null;
      
      const icon = disponible ? '✅' : '❌';
      console.log(`   $${precio?.toLocaleString('es-CL') || 'N/A'} ${icon}`);
      
    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
    }

    resultados.push({ tienda, url, precio, disponible, ok });
  }

  await browser.close();

  const datos = {
    timestamp: new Date().toISOString(),
    resultados,
    exitosos: resultados.filter(r => r.ok).length
  };

  // Comparar con historial
  const historial = cargarHistorial();
  const comparacion = compararPrecios(datos, historial);
  
  // Guardar nuevos resultados
  guardarResultados(datos);

  // Generar y enviar mensaje
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
