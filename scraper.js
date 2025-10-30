const puppeteer = require('puppeteer');

const urls = [
  {
    tienda: "Mercado Libre",
    url: "https://www.mercadolibre.cl/procesador-amd-ryzen-5-9600x-am5-39ghz54ghz-/up/MLCU3244552173",
    selectorPrecio: ".andes-money-amount__fraction",
    selector_disponible: ".ui-pdp-action--buy-button",
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
    selector_disponible: "[data-testid='add-to-cart-button']",
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
    // Estrategia 1: Verificar si existe el selector y no está deshabilitado
    if (selector_disponible) {
      const resultado = await page.evaluate((selector) => {
        const elemento = document.querySelector(selector);
        if (!elemento) return { existe: false };
        
        const disabled = elemento.disabled || 
                        elemento.getAttribute('disabled') !== null ||
                        elemento.classList.contains('disabled') ||
                        elemento.classList.contains('out-of-stock');
        
        const texto = elemento.innerText?.toLowerCase() || '';
        
        return {
          existe: true,
          disabled,
          texto,
          visible: elemento.offsetParent !== null
        };
      }, selector_disponible);
      
      if (resultado.existe && resultado.visible && !resultado.disabled) {
        return true;
      }
    }
    
    // Estrategia 2: Buscar texto "agotado" o "sin stock" en la página
    const hayTextoAgotado = await page.evaluate(() => {
      const texto = document.body.innerText.toLowerCase();
      return texto.includes('agotado') || 
             texto.includes('sin stock') || 
             texto.includes('out of stock') ||
             texto.includes('producto no disponible');
    });
    
    if (hayTextoAgotado) return false;
    
    // Estrategia 3: Buscar cualquier botón de agregar al carro
    const hayBotonCompra = await page.evaluate(() => {
      const botones = Array.from(document.querySelectorAll('button, a, input[type="submit"]'));
      return botones.some(btn => {
        const texto = (btn.innerText || btn.value || '').toLowerCase();
        const classes = btn.className.toLowerCase();
        
        const esBotonCompra = texto.includes('agregar') || 
                             texto.includes('añadir') || 
                             texto.includes('comprar') ||
                             texto.includes('add to cart') ||
                             classes.includes('add-to-cart') ||
                             classes.includes('buy');
        
        const noEstaDeshabilitado = !btn.disabled && 
                                   btn.getAttribute('disabled') === null &&
                                   btn.offsetParent !== null;
        
        return esBotonCompra && noEstaDeshabilitado;
      });
    });
    
    return hayBotonCompra;
    
  } catch (error) {
    console.error(`   ⚠️ Error verificando disponibilidad: ${error.message}`);
    return null;
  }
}

async function scrape() {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const resultados = [];

  for (const tiendaObj of urls) {
    const { tienda, url, selectorPrecio, selector_disponible, tomarSegundoPrecio } = tiendaObj;
    console.log(`🛒 Visitando ${tienda}: ${url}`);
    let intentos = 0;
    let success = false;
    let precio = null;
    let disponible = null;

    while (intentos < 3 && !success) {
      try {
        intentos++;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await new Promise(r => setTimeout(r, 3000));

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
          // Caso especial SP Digital
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

        // Verificar disponibilidad
        disponible = await verificarDisponibilidad(page, selector_disponible);

        success = true;
        
        const dispTexto = disponible === true ? '✅ Disponible' : 
                         disponible === false ? '❌ Sin stock' : '⚠️ Indeterminado';
        console.log(`   💰 Precio: $${precio?.toLocaleString('es-CL') || 'N/A'} | ${dispTexto}`);
        
      } catch (err) {
        console.error(`❌ Error en ${tienda} (intento ${intentos}):`, err.message);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    resultados.push({
      tienda,
      precio,
      disponible,
      ok: success,
      intentos
    });
  }

  console.log("\n📦 RESULTADOS FINALES:\n", JSON.stringify(resultados, null, 2));
  await browser.close();
}

scrape();
