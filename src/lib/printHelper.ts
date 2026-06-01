/**
 * Triggers a robust print setup of a specific container's HTML inside an iframe context,
 * which is highly compatible with sandboxed iframes (e.g., AI Studio preview, local wrappers).
 */
export function printElementViaIframe(elementId: string, printFormat: '58mm' | '80mm' | 'standard') {
  console.log("[PrintHelper] 1. printElementViaIframe started. elementId:", elementId, "format:", printFormat);

  let element: HTMLElement | null = null;
  try {
    element = document.getElementById(elementId) as HTMLElement | null;
    if (!element) {
      console.log("[PrintHelper] elementId not found, checking alternative IDs");
      element = document.getElementById('portal-printable-receipt') as HTMLElement | null;
    }
    if (!element) {
      element = document.getElementById('printable-receipt-container') as HTMLElement | null;
    }
    if (!element) {
      element = (document.querySelector('[id*="receipt"]') || document.querySelector('[id*="printable"]')) as HTMLElement | null;
    }
  } catch (error) {
    console.error("[PrintHelper] Error locating target element:", error);
  }

  if (!element) {
    console.error(`[PrintHelper] Element with ID "${elementId}" not found for iframe printing. Falling back to window.print()`);
    try {
      window.print();
    } catch (err) {
      console.error("[PrintHelper] Error triggering fallback window.print():", err);
    }
    return;
  }

  console.log("[PrintHelper] 2. target element found. ID:", element.id, "TagName:", element.tagName);

  let baseHtml = '';
  try {
    baseHtml = element.innerHTML;
  } catch (error) {
    console.error("[PrintHelper] Error getting element innerHTML:", error);
  }
  
  let iframe: HTMLIFrameElement;
  try {
    console.log("[PrintHelper] 3. iframe created");
    iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.zIndex = '-9999';
  } catch (error) {
    console.error("[PrintHelper] Error creating iframe:", error);
    try {
      window.print();
    } catch (e) {
      console.error("[PrintHelper] Failed window.print() fallback:", e);
    }
    return;
  }

  try {
    console.log("[PrintHelper] 4. iframe appended to DOM");
    document.body.appendChild(iframe);
  } catch (error) {
    console.error("[PrintHelper] Error appending iframe to DOM:", error);
    try {
      window.print();
    } catch (e) {
      console.error("[PrintHelper] Failed window.print() fallback:", e);
    }
    return;
  }

  let doc: Document | null = null;
  try {
    doc = iframe.contentWindow?.document || iframe.contentDocument;
  } catch (error) {
    console.error("[PrintHelper] Error getting iframe document object:", error);
  }

  if (!doc) {
    console.error('[PrintHelper] Could not access iframe document workspace. Falling back to window.print()');
    try {
      window.print();
    } catch (err) {
      console.error("[PrintHelper] Failed window.print() fallback:", err);
    }
    return;
  }

  // Pick up existing stylesheet links so styles copy over perfectly
  let styleTags = '';
  try {
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((styleNode) => {
      styleTags += styleNode.outerHTML;
    });
  } catch (error) {
    console.error("[PrintHelper] Error collecting stylesheets:", error);
  }

  try {
    console.log("[PrintHelper] 5. iframe document opened");
    doc.open();
  } catch (error) {
    console.error("[PrintHelper] Error opening iframe document:", error);
  }

  try {
    console.log("[PrintHelper] 6. html written");
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>BIZSEQ Receipt Print</title>
          ${styleTags}
          <style>
            @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&family=Inter:wght@400;500;700;900&display=swap');
            
            body {
              background-color: white !important;
              color: black !important;
              margin: 0 !important;
              padding: 0 !important;
              font-family: ${printFormat === 'standard' ? '"Inter", sans-serif' : '"JetBrains Mono", monospace'} !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }

            /* Overrule sizes strictly to respect selection */
            .printable-root {
              display: block !important;
              visibility: visible !important;
              width: ${printFormat === '58mm' ? '58mm' : printFormat === '80mm' ? '80mm' : '210mm'} !important;
              max-width: ${printFormat === '58mm' ? '58mm' : printFormat === '80mm' ? '80mm' : '210mm'} !important;
              margin: 0 auto !important;
              padding: ${printFormat === 'standard' ? '20px' : '0px'} !important;
              box-sizing: border-box;
            }

            @media print {
              html, body {
                background: white !important;
                color: black !important;
                margin: 0 !important;
                padding: 0 !important;
              }
              .printable-root {
                width: ${printFormat === '58mm' ? '58mm' : printFormat === '80mm' ? '80mm' : '210mm'} !important;
                max-width: ${printFormat === '58mm' ? '58mm' : printFormat === '80mm' ? '80mm' : '210mm'} !important;
              }
            }
          </style>
        </head>
        <body>
          <div class="printable-root">
            ${baseHtml}
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("[PrintHelper] Error writing HTML to iframe:", error);
  }

  try {
    console.log("[PrintHelper] 7. iframe document closed");
    doc.close();
  } catch (error) {
    console.error("[PrintHelper] Error closing iframe document:", error);
  }

  // Setup afterprint listeners if supported
  try {
    if (iframe.contentWindow) {
      console.log("[PrintHelper] Setting up afterprint event listener on iframe.contentWindow");
      iframe.contentWindow.addEventListener('afterprint', () => {
        console.log("[PrintHelper] 11. afterprint fired (from event listener)");
      });
      // also onafterprint property
      (iframe.contentWindow as any).onafterprint = () => {
        console.log("[PrintHelper] 11. afterprint fired (from onafterprint property)");
      };
    }
  } catch (error) {
    console.error("[PrintHelper] Error setting up afterprint listeners:", error);
  }

  // Trigger print and clean up
  setTimeout(() => {
    const hasContentWindow = !!iframe.contentWindow;
    console.log("[PrintHelper] 8. iframe contentWindow exists:", hasContentWindow);
    console.log("[PrintHelper] Sandbox / Iframe state (window.self !== window.top):", window.self !== window.top);

    try {
      console.log("[PrintHelper] window.onafterprint status:", typeof window.onafterprint);
      if (iframe.contentWindow) {
        console.log("[PrintHelper] iframe.contentWindow.onafterprint status:", typeof (iframe.contentWindow as any).onafterprint);
      }
    } catch (e) {
      console.error("[PrintHelper] Error checking onafterprint properties:", e);
    }

    if (hasContentWindow) {
      try {
        console.log("[PrintHelper] 9. focus called");
        iframe.contentWindow?.focus();
      } catch (error) {
        console.error("[PrintHelper] Error focusing iframe contentWindow:", error);
      }

      try {
        console.log("[PrintHelper] 10. print() about to be called (IMMEDIATELY BEFORE)");
        iframe.contentWindow?.print();
        console.log("[PrintHelper] 10. print() call executed successfully (IMMEDIATELY AFTER)");
      } catch (e) {
        console.warn("[PrintHelper] Failed standard iframe trigger. Falling back to parent print request.", e);
        try {
          console.log("[PrintHelper] Falling back to standard window.print() (IMMEDIATELY BEFORE)");
          window.print();
          console.log("[PrintHelper] Falling back to standard window.print() (IMMEDIATELY AFTER)");
        } catch (err) {
          console.error("[PrintHelper] Error running fallback window.print():", err);
        }
      }
    } else {
      console.warn("[PrintHelper] contentWindow not available. Triggering window.print()");
      try {
        console.log("[PrintHelper] Direct fallback to standard window.print() (IMMEDIATELY BEFORE)");
        window.print();
        console.log("[PrintHelper] Direct fallback to standard window.print() (IMMEDIATELY AFTER)");
      } catch (err) {
        console.error("[PrintHelper] Error running window.print():", err);
      }
    }

    // Diagnostics check after 2 seconds
    setTimeout(() => {
      console.log("[PrintHelper] Diagnostics stage check: 2 seconds after printing initialization flow completed.");
    }, 2000);

    // Clean up iframe after printing is prompted
    setTimeout(() => {
      try {
        console.log("[PrintHelper] 12. cleanup executed");
        if (iframe.parentNode) {
          document.body.removeChild(iframe);
          console.log("[PrintHelper] iframe removed from body successfully");
        } else {
          console.log("[PrintHelper] iframe parentNode not found, it might already be removed");
        }
      } catch (error) {
        console.error("[PrintHelper] Error during cleanup stage:", error);
      }
    }, 15000); 
  }, 1000);
}
