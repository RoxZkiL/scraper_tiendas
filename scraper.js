// scraper.js - Con ES Modules y puppeteer-real-browser para SP Digital
import fs from 'fs';
import puppeteer from 'puppeteer';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const urls = [
  {
    tienda: "Mercado Libre",
    url: "https://www.mercadolibre.cl/procesador-amd-ryzen-5-9600x-am5-39ghz54ghz-/up/MLCU3244552173",
    selectorPrecio: null, // Extracción especial
    selector_disponible: ".ui-pdp-buybox__quantity__available",
    esperaExtra: 8000,
    manejarMercadoLibre: true,
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
    usarRealBrowser: true,
    esperaExtra: 15000,
    extraerPrecioEspecial: true, // Extracción especial para precios con descuento
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
  console.log('🚀 Iniciando scraper con bypass Cloudflare...\n');

  let puppeteerReal;
  try {
    const imported = await import('puppeteer-real-browser');
    puppeteerReal = imported.connect;
  } catch (e) {
    console.log('⚠️ puppeteer-real-browser no disponible, SP Digital será omitido');
  }
  
  let browser;
  let page;
  let realBrowser;
  let realPage;
  
  const resultados = [];

  for (const tiendaObj of urls) {
    const { tienda, usarRealBrowser } = tiendaObj;
    console.log(`🛒 ${tienda}...`);
    
    let precio = null;
    let disponible = null;
    let url = tiendaObj.url || '';
    let ok = false;

    // SP DIGITAL: Usar puppeteer-real-browser si está disponible
    if (usarRealBrowser && puppeteerReal) {
      try {
        console.log(`   🛡️ Usando puppeteer-real-browser para bypass Cloudflare...`);
        
        if (!realBrowser) {
          const response = await puppeteerReal({
            headless: false,
            args: [],
            turnstile: true,
            connectOption: {},
            disableXvfb: false,
            ignoreAllFlags: false
          });
          
          realBrowser = response.browser;
          realPage = response.page;
        }

        await realPage.goto(url, { 
          waitUntil: "networkidle2", 
          timeout: 90000 
        });
        
        const { esperaExtra } = tiendaObj;
        await new Promise(r => setTimeout(r, esperaExtra || 15000));
        
        console.log(`   ⏳ Esperando bypass de Cloudflare...`);
        
        const pasoCF = await realPage.evaluate(() => {
          return !document.body.innerHTML.includes('Cloudflare');
        });
        
        if (!pasoCF) {
          console.log(`   ❌ No se pudo pasar Cloudflare`);
          resultados.push({ tienda, url, precio, disponible, ok });
          continue;
        }
        
        console.log(`   ✅ Cloudflare bypassed!`);
        
        await realPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise(r => setTimeout(r, 2000));
        
        const html = await realPage.content();
        fs.writeFileSync('SP-Digital-success.html', html);
        
        // Extracción especial de precio para SP Digital
        precio = await realPage.evaluate(() => {
          // Buscar específicamente "Otros medios de pago" y el precio que le sigue
          const textoCompleto = document.body.innerText;
          
          // Patrón 1: Buscar "Otros medios de pago" seguido del precio
          const matchOtrosMedios = textoCompleto.match(/Otros medios de pago[^\d]*\$?([\d]{3}\.[\d]{3})/);
          if (matchOtrosMedios) {
            const precio = parseInt(matchOtrosMedios[1].replace(/\./g, ''));
            if (precio > 100000 && precio < 500000) {
              return precio;
            }
          }
          
          // Patrón 2: Buscar en elementos con clase best-price que NO estén tachados
          const precioElements = document.querySelectorAll('[class*="best-price"], [class*="Price"]');
          for (let el of precioElements) {
            // Ignorar precios tachados
            if (el.classList.contains('strikethrough') || 
                el.closest('[class*="strikethrough"]') ||
                window.getComputedStyle(el).textDecoration.includes('line-through')) {
              continue;
            }
            
            const text = el.textContent || el.innerText;
            if (text && text.length < 15) {
              const clean = text.replace(/[^0-9]/g, '');
              if (clean.length >= 5 && clean.length <= 7) {
                const val = parseInt(clean);
                // Verificar que sea un precio razonable y NO el precio normal (399.990)
                if (val > 100000 && val < 390000) {
                  return val;
                }
              }
            }
          }
          
          // Patrón 3: Buscar todos los precios y tomar el menor que no sea el tachado
          const allPrices = [];
          const allElements = document.querySelectorAll('*');
          
          for (let el of allElements) {
            const text = el.textContent || el.innerText;
            const match = text.match(/\$?\s*([\d]{3}\.[\d]{3})/);
            
            if (match && el.children.length === 0) { // Solo elementos hoja
              const precio = parseInt(match[1].replace(/\./g, ''));
              if (precio > 100000 && precio < 390000) {
                // Verificar que no esté tachado
                const style = window.getComputedStyle(el);
                if (!style.textDecoration.includes('line-through')) {
                  allPrices.push(precio);
                }
              }
            }
          }
          
          // Ordenar y tomar el precio más común que no sea 399990
          const preciosFiltrados = allPrices.filter(p => p !== 399990);
          if (preciosFiltrados.length > 0) {
            // Contar frecuencias
            const frecuencias = {};
            for (let p of preciosFiltrados) {
              frecuencias[p] = (frecuencias[p] || 0) + 1;
            }
            
            // Encontrar el precio con mayor frecuencia
            let maxFreq = 0;
            let precioFinal = null;
            for (let [precio, freq] of Object.entries(frecuencias)) {
              if (freq > maxFreq) {
                maxFreq = freq;
                precioFinal = parseInt(precio);
              }
            }
            
            return precioFinal;
          }
          
          return null;
        });
        
        disponible = await verificarDisponibilidad(realPage, tiendaObj.selector_disponible);
        ok = precio !== null;
        
        const icon = disponible ? '✅' : '❌';
        console.log(`   💰 $${precio?.toLocaleString('es-CL') || 'N/A'} ${icon}`);
        
        resultados.push({ tienda, url, precio, disponible, ok });
        continue;
        
      } catch (err) {
        console.error(`   ❌ Error con real-browser: ${err.message}`);
        resultados.push({ tienda, url, precio, disponible, ok });
        continue;
      }
    }

    try {
      if (!browser) {
        browser = await puppeteer.launch({
          headless: 'new',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
        });
        
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setViewport({ width: 1920, height: 1080 });
      }

      const { selectorPrecio, selector_disponible, tomarSegundoPrecio, esperaExtra, manejarMercadoLibre } = tiendaObj;
      
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
      await new Promise(r => setTimeout(r, esperaExtra || 3000));
      
      // MANEJO ESPECIAL: Mercado Libre con página de intercepción
      if (manejarMercadoLibre) {
        const contenido = await page.content();
        
        // Verificar si hay página de login/intercepción
        if (contenido.includes('Ya tengo cuenta') || contenido.includes('Soy nuevo')) {
          console.log(`   🚪 Detectada página de intercepción, haciendo clic...`);
          
          const clicked = await page.evaluate(() => {
            const botones = Array.from(document.querySelectorAll('a, button'));
            const boton = botones.find(b => 
              (b.textContent || '').toLowerCase().includes('ya tengo cuenta')
            );
            if (boton) {
              boton.click();
              return true;
            }
            return false;
          });
          
          if (clicked) {
            await page.waitForNavigation({ timeout: 10000, waitUntil: 'networkidle2' }).catch(() => {});
            await new Promise(r => setTimeout(r, 5000));
          }
        }
        
        // Guardar HTML para debug
        const htmlFinal = await page.content();
        fs.writeFileSync('Mercado-Libre-debug.html', htmlFinal);
      }
      
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 1000));

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
      } else if (manejarMercadoLibre) {
        // Extracción especial para Mercado Libre
        console.log(`   🔍 Extrayendo precio de Mercado Libre...`);
        
        precio = await page.evaluate(() => {
          // Estrategia 1: Buscar el precio principal con la clase específica de ML
          const precioFraction = document.querySelector('.andes-money-amount__fraction');
          if (precioFraction) {
            const texto = precioFraction.textContent || precioFraction.innerText;
            const limpio = texto.replace(/[^0-9]/g, '');
            const valor = parseInt(limpio);
            if (valor > 100000 && valor < 500000) {
              return valor;
            }
          }
          
          // Estrategia 2: Buscar en la estructura de precios de ML
          const precioElements = document.querySelectorAll('[class*="price"], [class*="andes-money-amount"]');
          for (let el of precioElements) {
            // Ignorar precios tachados
            const style = window.getComputedStyle(el);
            if (style.textDecoration.includes('line-through')) {
              continue;
            }
            
            const texto = el.textContent || el.innerText;
            if (texto && texto.length < 20) {
              const limpio = texto.replace(/[^0-9]/g, '');
              if (limpio.length >= 5 && limpio.length <= 7) {
                const valor = parseInt(limpio);
                if (valor > 100000 && valor < 500000) {
                  return valor;
                }
              }
            }
          }
          
          // Estrategia 3: Buscar en el texto completo
          const bodyText = document.body.innerText;
          const matches = bodyText.match(/\$\s*([\d]{3}\.[\d]{3})/g);
          if (matches && matches.length > 0) {
            // Tomar el primer precio válido
            for (let match of matches) {
              const valor = parseInt(match.replace(/[^0-9]/g, ''));
              if (valor > 100000 && valor < 500000) {
                return valor;
              }
            }
          }
          
          return null;
        });
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

  if (browser) await browser.close();
  if (realBrowser) await realBrowser.close();

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
