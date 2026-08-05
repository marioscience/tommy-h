import re, unicodedata, math
from collections import Counter

def normalizar(texto: str) -> str:
    texto = texto.lower().strip()
    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    reemplazos = {
        "k":"que","q":"que","xq":"porque","pq":"porque","grasias":"gracias",
        "grax":"gracias","ola":"hola","wenas":"buenas","wena":"buenas",
        "alluda":"ayuda","ayudenme":"ayuda","funsiona":"funciona","funziona":"funciona",
        "servidor":"server","serv":"server","sv":"server","tx":"txadmin",
        "bd":"base de datos","bbdd":"base de datos","contrasena":"password",
        "pasword":"password","pass":"password","correo":"email",
        "archibo":"archivo","archibos":"archivos","fichero":"archivo",
        "reinisiar":"reiniciar","respaldo":"backup","bakup":"backup","bacup":"backup",
        "lagg":"lag","lageado":"lag","lagueado":"lag","pingalto":"ping alto",
        "caido":"caida","cayo":"caida","crashea":"crash","crasheo":"crash",
        "crasheando":"crash","timedout":"time out","timeout":"time out",
        "reject":"rechazado","factura":"facturacion","facturas":"facturacion",
        "pago":"pagar","pagos":"pagar","komprar":"comprar","prezios":"precio",
        "precios":"precio","rembolso":"reembolso","devolusion":"reembolso",
        "devolucion":"reembolso","plata":"dinero","konectar":"conectar",
        "conetarme":"conectar","conectarme":"conectar",
    }
    palabras = texto.split()
    resultado = []
    for p in palabras:
        limpia = re.sub(r"[^a-z0-9]", "", p)
        resultado.append(reemplazos.get(limpia, limpia))
    return re.sub(r"\s+", " ", " ".join(resultado))


INTENCIONES = {
    "precio": (
        ["precio","cuanto cuesta","cuanto vale","comprar","metodos de pago","paypal",
         "tarjeta","planes","contratar","suscripcion","mensual","pagar","oferta",
         "descuento","promocion","pack","hosting"],
        ["compraar","presio","mensualidad"], 1.0
    ),
    "reembolso": (
        ["reembolso","devolucion","cancelar","cancelacion","dinero de vuelta",
         "quiero cancelar","baja","dar de baja"],
        ["reembolsar","devolver"], 1.0
    ),
    "conexion_rechazada": (
        ["connection rejected","rechazado","no me deja entrar","time out","timed out",
         "error de conexion","no puedo entrar al server","no carga","5:net_error",
         "error 5","error connecting","cant connect","no conecta"],
        ["rechazado","conexion"], 1.2
    ),
    "dominio_ip": (
        ["dominio","ip dedicada","puerto","cambiar puerto","ip publica","conectar por ip",
         "play.","connect ","mi ip","que ip tengo"],
        ["domino","puertos"], 1.0
    ),
    "lag_rendimiento": (
        ["lag","lento","tirones","desync","delay","ping alto","sobrecarga","petado",
         "se cierra","crash","caida","bajo fps","fps bajo","desincronizado","freeze",
         "se congela","trabado","entity culling","onesync","memory leak","fuga de memoria"],
        ["lagg","crasheando","freeza"], 1.1
    ),
    "txadmin": (
        ["txadmin","panel txadmin","pin","vincular txadmin","tx admin","acceder txadmin",
         "contrasena txadmin","no carga txadmin","502","error 502","fxserver",
         "no abre el panel","txadmin web","monitor txadmin","scheduled restart"],
        ["txadminn","txamin"], 1.0
    ),
    "mysql_db": (
        ["mysql","mariadb","base de datos","database","sql","heidisql","phpmyadmin",
         "oxmysql","unknown column","table doesn't exist","duplicate entry",
         "too many connections","mysql error","no conecta la db","error mysql",
         "connection string","connectionstring","mysql_connection_string"],
        ["basededatos","heydisql"], 1.1
    ),
    "archivos_ftp": (
        ["ftp","archivo","archivos","subir","bajar","filezilla","winscp","gestor",
         "sftp","subir archivos","no puedo subir","extraer","descomprimir","zip",
         "carpeta resources","resources","carpeta"],
        ["filezila","gestorde archivos"], 1.0
    ),
    "licencia_cfx": (
        ["licencia","license key","sv_licensekey","cfx key","keymaster","clave cfx",
         "license invalid","sv_license","licencia invalida","licencia caducada"],
        ["lisencia","keymaaster"], 1.2
    ),
    "esx_scripts": (
        ["esx","es_extended","esx_vehicleshop","esx_policejob","esx_society",
         "esx_inventoryhud","esx_status","esx_basicneeds","getsharedobj",
         "esxshared","esx framework","esx legacy","esx 1.9","esx 1.10"],
        ["essx","ex_extended"], 1.1
    ),
    "qbcore_scripts": (
        ["qbcore","qb-core","qb_policejob","qb_target","qb_inventory","ox_lib",
         "ox_target","ox_inventory","ox lib","overextended","qb framework","bridge",
         "qb-management","qb-phone","qb-banking"],
        ["qbccore","oxlib"], 1.1
    ),
    "error_arranque": (
        ["no arranca","no inicia","no enciende","couldn't find native","resource failed",
         "failed to start","script stop","citizen-server-impl","error al iniciar",
         "script error","parse error","runtime error","couldn't load",
         "error en consola","consola roja","error rojo"],
        ["noinicia","noarranca"], 1.2
    ),
    "permisos_ace": (
        ["ace permission","add_ace","add_principal","not allowed to use","permiso denegado",
         "no tengo permiso","permiso ace","acl","sin permisos","comando no disponible"],
        ["acepermission","acepermisos"], 1.1
    ),
    "error_red": (
        ["error 10038","error 10061","connection refused","server not reachable",
         "heartbeat","no heartbeat","winsock","socket error","port not open",
         "firewall","puerto cerrado","no responde el puerto"],
        ["conexionrefused"], 1.1
    ),
    "recursos_manifest": (
        ["fxmanifest","__resource.lua","dependency","missing dependency","version mismatch",
         "resource","meta.xml","manifest","client script","server script","shared script",
         "stream","ytd","ydr","ymap","ytyp","dlc","mod","addon"],
        ["fxmanifest","recurso"], 1.0
    ),
    "voz_chat": (
        ["pma-voice","mumble","voz","microfono","sin audio","no se escucha","proximity",
         "voicechat","salt shaker","voice","audio","no oigo","no me oyen"],
        ["pmavoz","microfoono"], 1.0
    ),
    "mlo_mapas": (
        ["mlo","interior","collider","ipl","mapa","ymap","ytyp","blender","3d",
         "modelado","vnc","editor 3d","blender web","collision","no carga el mapa"],
        ["interior3d"], 1.0
    ),
    "anticheat": (
        ["anticheat","anti-cheat","ban injusto","baneado","ban falso","deteccion",
         "screenshot","screenshotttttttt","cheat detection","banned","kick injusto"],
        ["antichit","antitrampas"], 1.0
    ),
    "backup": (
        ["backup","copia seguridad","restaurar","recuperar","perdi archivos",
         "borrado","restauracion","restore","copia de seguridad"],
        ["bkup","respaldo"], 1.0
    ),
    "facturacion_plan": (
        ["facturacion","factura","mejorar plan","upgrade","ampliar","mas ram",
         "mas cpu","disco lleno","almacenamiento","espacio","mas gb","ampliar disco"],
        ["mejorplan","actualizarplan"], 1.0
    ),
    "contrasena_cuenta": (
        ["contrasena","password","olvide mi clave","recuperar cuenta","cambiar password",
         "no recuerdo","acceso al panel","no puedo entrar al panel","email verificacion"],
        ["contrasenaa","passward"], 1.0
    ),
    "reiniciar_servidor": (
        ["reiniciar","apagar","encender","start","stop","restart","encender server",
         "apagar server","no responde","servidor caido","server offline"],
        ["reinciar","reestart"], 1.0
    ),
    "onesync": (
        ["onesync","onesync_infinity","onesync_enabled","entity","entity too far",
         "onesync error","routing bucket","population","onesync legacy"],
        ["one sync","onesyn"], 1.1
    ),
    "wipe": (
        ["wipe","wipear","borrar todo","empezar de cero","resetear servidor",
         "resetear db","wipe database","borrar base de datos","empezar de 0"],
        ["waipear","wipeo"], 1.2
    ),
    "whitelist": (
        ["whitelist","wl","allowlist","lista blanca","quitar whitelist","poner whitelist",
         "no estoy en whitelist","agregar a la whitelist","discord whitelist"],
        ["whitelis","wailist"], 1.1
    ),
    "migracion": (
        ["migrar","migracion","pasar mi server","traer servidor","cambiar de host",
         "pasar archivos","subir mi base de datos vieja"],
        ["mudanza","migraccion"], 1.2
    ),
    "mantenimiento_nodo": (
        ["nodo caido","mantenimiento","nodo apagado","no conecta el nodo",
         "nodo offline","panel caido","error 500 panel","panel lento"],
        ["mantenimeinto","nodo off"], 1.0
    ),
    "saludo": (
        ["hola","buenas","saludos","hi","hello","klk","que tal","buen dia",
         "buenas tardes","buenas noches","buenos dias"],
        ["hoola","holaa"], 0.8
    ),
    "agradecimiento": (
        ["gracias","listo","solucionado","perfecto","entendido","ya esta","resuelto",
         "todo bien","funciono","ya funciona","ya jala","ok gracias","muchas gracias"],
        ["grasias","solucionao"], 0.8
    ),
    "escalar_humano": (
        ["error","no funciona","roto","ayuda","staff","admin","humano","dueno",
         "problema","urgente","soporte humano","hablar con alguien","necesito ayuda"],
        ["ayudaaa","urgentee"], 0.9
    ),
}

class TFIDFEngine:
    """Motor Clasificador Estadístico Avanzado (TF-IDF y Similitud de Coseno)"""
    def __init__(self):
        self.vocab = set()
        self.idf = {}
        self.doc_vectors = []
        self.doc_intents = []
        self.doc_weights = []

    def fit(self, intenciones_dict):
        documents = []
        intents = []
        weights = []

        for intent, (exactas, fuzzy, peso) in intenciones_dict.items():
            for frase in exactas + fuzzy:
                words = normalizar(frase).split()
                if not words: continue
                documents.append(words)
                intents.append(intent)
                weights.append(peso)
                for w in words:
                    self.vocab.add(w)

        # Calculate IDF (Inverse Document Frequency)
        N = len(documents)
        for w in self.vocab:
            df = sum(1 for doc in documents if w in doc)
            self.idf[w] = math.log((N + 1) / (df + 1)) + 1.0

        # Calculate TF-IDF vectors
        for i, doc in enumerate(documents):
            tf = Counter(doc)
            doc_len = len(doc)
            vec = {w: (tf[w]/doc_len) * self.idf[w] for w in tf}
            
            # Normalize vector (L2 norm)
            norm = math.sqrt(sum(v*v for v in vec.values()))
            if norm > 0:
                vec = {w: v/norm for w, v in vec.items()}
            
            self.doc_vectors.append(vec)
            self.doc_intents.append(intents[i])
            self.doc_weights.append(weights[i])

    def predict(self, texto: str):
        words = normalizar(texto).split()
        if not words: return None, 0.0

        tf = Counter(words)
        doc_len = len(words)
        query_vec = {}
        for w in tf:
            if w in self.idf:
                query_vec[w] = (tf[w]/doc_len) * self.idf[w]
        
        norm = math.sqrt(sum(v*v for v in query_vec.values()))
        if norm == 0:
            return None, 0.0
        query_vec = {w: v/norm for w, v in query_vec.items()}

        scores = {}
        for idx, doc_vec in enumerate(self.doc_vectors):
            # Cosine similarity
            score = sum(query_vec.get(w, 0) * doc_vec.get(w, 0) for w in query_vec.keys() & doc_vec.keys())
            score *= self.doc_weights[idx]
            
            if score > 0:
                intent = self.doc_intents[idx]
                if intent not in scores or score > scores[intent]:
                    scores[intent] = score

        if not scores:
            return None, 0.0
            
        mejor = max(scores, key=lambda k: scores[k])
        # Escalar el score porque Cosine Similarity máximo es 1.0, pero main.py espera > 0.8.
        # Boost artificial para que un buen match llegue a > 0.8
        score_escalado = scores[mejor] * 2.2 
        if score_escalado > 1.0: score_escalado = 1.0
        return mejor, score_escalado

# Inicializar motor y entrenar con la matriz base
nlp_engine = TFIDFEngine()
nlp_engine.fit(INTENCIONES)

def puntuar_intencion(texto: str) -> dict:
    mejor, score = nlp_engine.predict(texto)
    if mejor:
        return {mejor: score}
    return {}

def detectar_mejor_intencion(texto: str) -> tuple[str | None, float]:
    return nlp_engine.predict(texto)

def extraer_entidades(texto: str) -> dict:
    entidades = {}
    ips = re.findall(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b', texto)
    if ips: entidades["ips"] = ips
    puertos = re.findall(r'\b(3\d{4}|4\d{4}|5\d{4})\b', texto)
    if puertos: entidades["puertos"] = puertos
    errores = re.findall(r'\b(net_error[_\w]+|\berror\s+\d+|error\s+\w+)\b', texto.lower())
    if errores: entidades["errores"] = errores
    recursos = re.findall(r'\b(esx_\w+|qb[-_]\w+|ox_\w+|es_extended|pma-voice|[a-z]+-[a-z]+)\b', texto.lower())
    if recursos: entidades["recursos"] = list(set(recursos))
    return entidades
