#!/usr/bin/env python3
"""
OxideProxy vs RageNodes • Advanced L4/L7 Benchmark Suite
Compara latencia TCP (Handshake RTT), UDP (Gaming Ping), Jitter y pérdida de paquetes.

Uso:
  python3 benchmark.py --proxy <proxy_ip:port> --ragenodes <direct_ip:port> [--proto tcp|udp|both]
"""

import sys
import time
import socket
import argparse
import statistics
from concurrent.futures import ThreadPoolExecutor

def parse_args():
    parser = argparse.ArgumentParser(description="OxideProxy vs RageNodes Benchmark Suite")
    parser.add_argument("--proxy", required=True, help="Dirección del OxideProxy (Ej. 127.0.0.1:8443 o 127.0.0.1:8080)")
    parser.add_argument("--ragenodes", required=True, help="Dirección directa de RageNodes (Ej. 10.5.0.15:30120)")
    parser.add_argument("--count", type=int, default=50, help="Número de paquetes de prueba por endpoint (default: 50)")
    parser.add_argument("--timeout", type=float, default=2.0, help="Timeout de conexión en segundos (default: 2.0)")
    parser.add_argument("--proto", choices=["tcp", "udp", "both"], default="both", help="Protocolo a evaluar (default: both)")
    return parser.parse_args()

def split_target(target):
    parts = target.split(":")
    if len(parts) != 2:
        print(f"[ERROR] Formato de destino inválido: {target}. Debe ser IP:Puerto")
        sys.exit(1)
    return parts[0], int(parts[1])

def measure_tcp_latency(ip, port, count, timeout):
    latencies = []
    errors = 0

    for _ in range(count):
        start = time.perf_counter()
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        try:
            s.connect((ip, port))
            latencies.append((time.perf_counter() - start) * 1000) # ms
        except socket.error:
            errors += 1
        finally:
            s.close()
        time.sleep(0.02) # Pequeña pausa entre pings

    return calculate_stats(latencies, errors, count)

def measure_udp_latency(ip, port, count, timeout):
    latencies = []
    errors = 0
    payload = b"\xFF\xFF\xFF\xFFgetstatus\x00" # Payload genérico de gaming (Quake/FiveM/Source)

    for _ in range(count):
        start = time.perf_counter()
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(timeout)
        try:
            s.sendto(payload, (ip, port))
            # Esperamos respuesta si el servidor responde, o medimos el RTT del echo
            _data, _addr = s.recvfrom(1024)
            latencies.append((time.perf_counter() - start) * 1000)
        except socket.timeout:
            # En UDP si el servidor no tiene un protocolo de echo activo, simulamos el envío exitoso
            # Para fines de benchmark real, requerimos que responda. Si hay timeout, es error o drop.
            errors += 1
        finally:
            s.close()
        time.sleep(0.02)

    return calculate_stats(latencies, errors, count)

def calculate_stats(latencies, errors, count):
    if not latencies:
        return {
            "min": 0.0, "max": 0.0, "avg": 0.0, "jitter": 0.0,
            "loss": (errors / count) * 100 if count else 100.0,
            "success": 0
        }

    avg = statistics.mean(latencies)
    jitter = statistics.stdev(latencies) if len(latencies) > 1 else 0.0
    loss = (errors / count) * 100

    return {
        "min": min(latencies),
        "max": max(latencies),
        "avg": avg,
        "jitter": jitter,
        "loss": loss,
        "success": len(latencies)
    }

def print_banner():
    print("\n" + "="*75)
    print(" 🚀  OXIDEPROXY vs RAGENODES • ADVANCED L4/L7 BENCHMARK SUITE  🚀")
    print("="*75 + "\n")

def print_comparison_table(title, proxy_stats, rage_stats):
    print(f"--- {title} ---")
    print(f"{'Métrica':<20} | {'OxideProxy (Rust eBPF/BBR)':<25} | {'RageNodes (Directo)':<22} | {'Diferencia / Ventaja'}")
    print("-" * 90)

    # Helper para formatear
    def fmt(val, unit="ms"): return f"{val:.2f} {unit}"
    
    # Min
    diff_min = proxy_stats['min'] - rage_stats['min']
    adv_min = f"{abs(diff_min):.2f} ms {'más rápido' if diff_min < 0 else 'de overhead'}" if proxy_stats['success'] and rage_stats['success'] else "N/A"
    print(f"{'Latencia Mínima':<20} | {fmt(proxy_stats['min']):<25} | {fmt(rage_stats['min']):<22} | {adv_min}")

    # Max
    diff_max = proxy_stats['max'] - rage_stats['max']
    adv_max = f"{abs(diff_max):.2f} ms {'más rápido' if diff_max < 0 else 'de overhead'}" if proxy_stats['success'] and rage_stats['success'] else "N/A"
    print(f"{'Latencia Máxima':<20} | {fmt(proxy_stats['max']):<25} | {fmt(rage_stats['max']):<22} | {adv_max}")

    # Avg
    diff_avg = proxy_stats['avg'] - rage_stats['avg']
    adv_avg = f"{abs(diff_avg):.2f} ms {'a favor (BBR/ZeroCopy)' if diff_avg < 0 else 'de overhead Proxy'}" if proxy_stats['success'] and rage_stats['success'] else "N/A"
    print(f"{'Latencia Promedio':<20} | {fmt(proxy_stats['avg']):<25} | {fmt(rage_stats['avg']):<22} | {adv_avg}")

    # Jitter
    diff_jit = proxy_stats['jitter'] - rage_stats['jitter']
    adv_jit = f"{abs(diff_jit):.2f} ms {'más estable' if diff_jit < 0 else 'menos estable'}" if proxy_stats['success'] and rage_stats['success'] else "N/A"
    print(f"{'Jitter (Estabilidad)':<20} | {fmt(proxy_stats['jitter']):<25} | {fmt(rage_stats['jitter']):<22} | {adv_jit}")

    # Loss
    print(f"{'Pérdida de Paquetes':<20} | {fmt(proxy_stats['loss'], '%'):<25} | {fmt(rage_stats['loss'], '%'):<22} | {'Éxito: ' + str(proxy_stats['success']) + ' vs ' + str(rage_stats['success'])}")
    print("-" * 90 + "\n")

def main():
    args = parse_args()
    print_banner()

    proxy_ip, proxy_port = split_target(args.proxy)
    rage_ip, rage_port = split_target(args.ragenodes)

    print(f"[!] Evaluando OxideProxy en: {proxy_ip}:{proxy_port}")
    print(f"[!] Evaluando RageNodes en : {rage_ip}:{rage_port}")
    print(f"[!] Paquetes por prueba : {args.count} (Timeout: {args.timeout}s)\n")

    # Ejecutar pruebas TCP
    if args.proto in ["tcp", "both"]:
        print("[*] Iniciando prueba de Handshake TCP (Midiendo RTT SYN/ACK)...")
        with ThreadPoolExecutor(max_workers=2) as executor:
            fut_proxy = executor.submit(measure_tcp_latency, proxy_ip, proxy_port, args.count, args.timeout)
            fut_rage = executor.submit(measure_tcp_latency, rage_ip, rage_port, args.count, args.timeout)
            proxy_tcp = fut_proxy.result()
            rage_tcp = fut_rage.result()
        print_comparison_table("EVALUACIÓN DE LATENCIA TCP (HANDSHAKE RTT)", proxy_tcp, rage_tcp)

    # Ejecutar pruebas UDP
    if args.proto in ["udp", "both"]:
        print("[*] Iniciando prueba de Gaming UDP (Midiendo Zero-Copy vs Kernel Directo)...")
        with ThreadPoolExecutor(max_workers=2) as executor:
            fut_proxy = executor.submit(measure_udp_latency, proxy_ip, proxy_port, args.count, args.timeout)
            fut_rage = executor.submit(measure_udp_latency, rage_ip, rage_port, args.count, args.timeout)
            proxy_udp = fut_proxy.result()
            rage_udp = fut_rage.result()
        print_comparison_table("EVALUACIÓN DE LATENCIA UDP (GAMING ECHO)", proxy_udp, rage_udp)

    print("💡 CONCLUSIÓN TÉCNICA:")
    print(" • OxideProxy utiliza BBR y TCP_NODELAY a nivel de kernel junto con Zero-Copy en UDP.")
    print(" • Es normal observar un ligero overhead (< 1-2 ms) en la latencia mínima debido al salto del proxy,")
    print("   pero bajo congestión o ataques DDoS, OxideProxy mantendrá el Jitter estable gracias al filtrado eBPF/XDP,")
    print("   mientras que una conexión directa a RageNodes sufrirá degradación o caída del servicio.")
    print("="*75 + "\n")

if __name__ == "__main__":
    main()
