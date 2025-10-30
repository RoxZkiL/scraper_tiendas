// scraper.js - Versión mejorada con anti-detección avanzada
const puppeteer = require('puppeteer');
const fs = require('fs');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const urls = [
  {
    tienda: "Mercado Libre",
    url: "https://www.mercadolibre.cl/procesador-amd-ryzen-5-9600x-am5-39ghz54ghz-/up/MLCU3244552173",
    selectorPrecio: null,
    selector_disponible: ".ui-pdp-buybox__quantity__available",
    esperaExtra: 8000,
    manejarIntercepcion: true, // Manejar página de login
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
    esperaExtra: 10000,
    bypassCloudflare: true, // Activar bypass especial
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

// Función para simular comportamiento humano
async function comportamientoHumano(page) {
  // Movimientos aleatorios del mouse
  await page.mouse.move(100, 100);
  await page.mouse.move(300, 200);
  await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
  
  // Scroll suave
  await page.evaluate(() => {
    window.scrollTo({ top: 300, behavior: 'smooth' });
  });
  await new Promise(r => setTimeout(r, 1000));
}

// Configurar página con anti-detección avanzada
async function configurarPaginaAntiDeteccion(page) {
  // Ocultar webdriver y automatización
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    
    // Eliminar variables de automatización
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    
    // Simular plugins y características de navegador real
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });
    
    Object.defineProperty(navigator, 'languages', {
      get: () => ['es-CL', 'es', 'en']
    });
    
    // Simular características de Chrome real
    window.chrome = {
      runtime: {}
    };
    
    // Permisos
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
  });

  // Headers realistas
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'es-CL,es;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'max-age=0',
    'Sec-Ch-Ua': '"Chromium";v="120", "Google Chrome";v="120", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  });

  // User agent realista
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  
  await page.setViewport({ 
    width: 1920, 
    height: 1080,
    deviceScaleFactor: 1,
    hasTouch: false,
    isLandscape: true
  });
}

async function scrape() {
  console.log('🚀 Iniciando scraper con anti-detección avanzada...\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1920,1080',
      '--start-maximized',
      // Args adicionales para evitar detección
      '--disable-blink-features=AutomationControlled',
      '--exclude-switches=enable-automation',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions'
    ],
    ignoreHTTPSErrors: true
  });

  const page = await browser.newPage();
  await configurarPaginaAntiDeteccion(page);

  const resultados = [];

  for (const tiendaObj of urls) {
    const { 
      tienda, url, selectorPrecio, selector_disponible, 
      tomarSegundoPrecio, esperaExtra, manejarIntercepcion, 
      bypassCloudflare 
    } = tiendaObj;
    
    console.log(`🛒 ${tienda}...`);
    
    let precio = null;
    let disponible = null;
    let ok = false;

    try {
      // Navegar con opciones más realistas
      const response = await page.goto(url, { 
        waitUntil: ["domcontentloaded", "networkidle2"],
        timeout: 60000 
      });

      console.log(`   📡 Status: ${response?.status()}`);
      
      // Comportamiento humano inicial
      await comportamientoHumano(page);
      
      const tiempoEspera = esperaExtra || 3000;
      await new Promise(r => setTimeout(r, tiempoEspera));

      // MANEJO ESPECIAL: Mercado Libre - Detectar y manejar página de login
      if (manejarIntercepcion) {
        const urlActual = page.url();
        const contenidoPagina = await page.content();
        
        console.log(`   🔍 URL actual: ${urlActual}`);
        
        // Verificar si estamos en la página de login/intercepción
        const esIntercepcion = contenidoPagina.includes('Ya tengo cuenta') || 
                              contenidoPagina.includes('Soy nuevo') ||
                              urlActual.includes('login');
        
        if (esIntercepcion) {
          console.log(`   🚪 Detectada página de login, intentando clickear "Ya tengo cuenta"...`);
          
          try {
            // Buscar y clickear el botón "Ya tengo cuenta"
            const botonClicked = await page.evaluate(() => {
              const botones = Array.from(document.querySelectorAll('button, a'));
              const boton = botones.find(b => 
                (b.textContent || '').toLowerCase().includes('ya tengo cuenta') ||
                (b.textContent || '').toLowerCase().includes('tengo cuenta')
              );
              
              if (boton) {
                boton.click();
                return true;
              }
              return false;
            });
            
            if (botonClicked) {
              console.log(`   ✓ Click realizado, esperando redirección...`);
              await page.waitForNavigation({ timeout: 10000, waitUntil: 'networkidle2' }).catch(() => {});
              await new Promise(r => setTimeout(r, 3000));
            } else {
              console.log(`   ⚠️ No se encontró botón para clickear`);
            }
          } catch (e) {
            console.log(`   ⚠️ Error manejando intercepción: ${e.message}`);
          }
        }
      }

      // MANEJO ESPECIAL: SP Digital - Bypass Cloudflare
      if (bypassCloudflare) {
        const esCloudflare = await page.evaluate(() => {
          return document.body.innerHTML.includes('Cloudflare') || 
                 document.body.innerHTML.includes('challenge');
        });
        
        if (esCloudflare) {
          console.log(`   ⏳ Detectado Cloudflare, esperando challenge...`);
          await new Promise(r => setTimeout(r, 15000)); // Esperar más tiempo
          
          // Reintentar navegación
          await page.goto(url, { 
            waitUntil: "networkidle2", 
            timeout: 60000 
          });
          await new Promise(r => setTimeout(r, 5000));
        }
      }
      
      // Scroll para lazy loading
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight / 2);
      });
      await new Promise(r => setTimeout(r, 1000));
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await new Promise(r => setTimeout(r, 1500));

      // Guardar HTML para debug
      const html = await page.content();
      if (tienda === "SP Digital" || tienda === "Mercado Libre") {
        fs.writeFileSync(`${tienda.replace(/\s+/g, '-')}-debug.html`, html);
        console.log(`   💾 HTML guardado para debug`);
      }

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
        // Extracción inteligente de precio
        precio = await page.evaluate(() => {
          const selectors = [
            '.andes-money-amount__fraction',
            '[class*="price-tag"]',
            '[class*="price"]',
            '[class*="Price"]',
            '[data-price]',
            '.price',
            '.precio'
          ];
          
          for (let selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (let el of elements) {
              const text = el.textContent || el.innerText;
              if (text && text.length < 15) {
                const clean = text.replace(/[^0-9]/g, '');
                if (clean.length >= 5 && clean.length <= 7) {
                  const val = parseInt(clean);
                  if (val > 100000 && val < 500000) {
                    return val;
                  }
                }
              }
            }
          }
          
          // Buscar en texto completo
          const allText = document.body.innerText;
          const matches = allText.match(/\$?\s*([\d]{3}\.[\d]{3})/g);
          if (matches) {
            for (let match of matches) {
              const val = parseInt(match.replace(/[^0-9]/g, ''));
              if (val > 100000 && val < 500000) {
                return val;
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
      
      // Screenshot en caso de fallo
      if (!precio) {
        try {
          await page.screenshot({ 
            path: `error-${tienda.replace(/\s+/g, '-')}.png`,
            fullPage: false
          });
          console.log(`   📸 Screenshot guardado`);
        } catch (e) {}
      }
      
    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
      
      try {
        await page.screenshot({ 
          path: `error-${tienda.replace(/\s+/g, '-')}.png`,
          fullPage: false
        });
      } catch (e) {}
    }

    resultados.push({ tienda, url, precio, disponible, ok });
    
    // Pequeña pausa entre tiendas
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
  }

  await browser.close();

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
