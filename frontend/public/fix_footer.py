import re

with open('/opt/ragenodes-ultimate/frontend/public/index.html', 'r') as f:
    content = f.read()

# Pattern to match the bad footer
# <div class="catalog-card-footer" style="display: flex; gap: 8px;">
#   <button class="btn catalog-card-btn" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--muted); padding: 8px; font-size: 0.8rem;" onclick="this.parentElement.parentElement.click()"><i class="fa-solid fa-circle-info"></i></button>
#   <div><span class="catalog-card-price-label">Desde</span><span class="catalog-card-price-val">$...<span style="font-size:0.75rem; font-weight:normal; color:var(--muted)">/mes</span></span></div>
#   <button class="btn catalog-card-btn"...>Alquilar</button>
# </div>

pattern = re.compile(
    r'<div class="catalog-card-footer" style="display: flex; gap: 8px;">\s*'
    r'<button class="btn catalog-card-btn" style="background: rgba\(255,255,255,0\.05\); border: 1px solid rgba\(255,255,255,0\.1\); color: var\(--muted\); padding: 8px; font-size: 0\.8rem;" onclick="this\.parentElement\.parentElement\.click\(\)"><i class="fa-solid fa-circle-info"></i></button>\s*'
    r'(<div><span class="catalog-card-price-label">.*?</div>)\s*'
    r'(<button class="btn catalog-card-btn".*?>Alquilar</button>)\s*'
    r'</div>',
    re.DOTALL
)

def replace_footer(match):
    price_div = match.group(1)
    alquilar_btn = match.group(2)
    return f"""<div class="catalog-card-footer">
                          {price_div}
                          <div style="display: flex; gap: 8px; align-items: center;">
                              <button class="btn catalog-card-btn" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-light); padding: 8px 12px; font-size: 0.9rem;" onclick="event.stopPropagation(); this.closest('.catalog-card').click()" title="Más Información"><i class="fa-solid fa-circle-info"></i> Info</button>
                              {alquilar_btn}
                          </div>
                      </div>"""

new_content = pattern.sub(replace_footer, content)

with open('/opt/ragenodes-ultimate/frontend/public/index.html', 'w') as f:
    f.write(new_content)

print("Footers updated!")
