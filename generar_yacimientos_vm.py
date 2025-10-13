import geopandas as gpd
import pandas as pd
from shapely.geometry import Point
import numpy as np

# --- Archivos fuente ---
pozos_file = "pozos_neuquina_2024_2025_min_corrected.geojson"
vaca_muerta_file = "data/concesiones_neuquen.geojson"

# --- Cargar datos ---
gdf_pozos = gpd.read_file(pozos_file)
gdf_vm = gpd.read_file(vaca_muerta_file)

print("Pozos cargados:", len(gdf_pozos))

# --- Filtrar pozos dentro del área de Vaca Muerta ---
gdf_pozos = gdf_pozos.to_crs(gdf_vm.crs)
gdf_vm_union = gdf_vm.unary_union
gdf_vm_pozos = gdf_pozos[gdf_pozos.geometry.within(gdf_vm_union)].copy()

print("Pozos dentro de Vaca Muerta:", len(gdf_vm_pozos))

# --- Clasificar empresas ---
def clasificar_empresa(empresa):
    if pd.isna(empresa):
        return "N/D", "#CCCCCC"
    e = empresa.upper()
    if "YPF" in e:
        return "YPF", "#0178D6"
    elif any(x in e for x in ["PAMPA", "PLUSPETROL", "VISTA", "CAPEX", "PETERSEN", "PCR"]):
        return "ARGENTINA", "#9BBCDC"
    else:
        return "EXTRANJERA", "#F4785E"

gdf_vm_pozos[["tipo_empresa", "color"]] = gdf_vm_pozos["operador"].apply(lambda e: pd.Series(clasificar_empresa(e)))

# --- Eliminar duplicados ---
gdf_vm_pozos = gdf_vm_pozos.drop_duplicates(subset=["idpozo", "yacimiento"])

# --- Limpiar valores nulos ---
gdf_vm_pozos = gdf_vm_pozos.dropna(subset=["geometry", "yacimiento"])
gdf_vm_pozos = gdf_vm_pozos[gdf_vm_pozos.geometry.is_valid]

# --- Agrupar por yacimiento ---
yac_groups = gdf_vm_pozos.groupby("yacimiento")

yac_list = []
for name, group in yac_groups:
    if group.empty:
        continue
    num_pozos = len(group)
    color_mayor = group["color"].value_counts().idxmax()
    tipo_mayor = group["tipo_empresa"].value_counts().idxmax()
    centroid = group.geometry.unary_union.centroid
    yac_list.append({
        "yacimiento": name,
        "num_pozos": num_pozos,
        "tipo_dominante": tipo_mayor,
        "color": color_mayor,
        "geometry": centroid
    })

gdf_yac = gpd.GeoDataFrame(yac_list, crs=gdf_vm_pozos.crs)

print("Yacimientos generados:", len(gdf_yac))

# --- Escala de tamaño ---
def escala_radio(n):
    if n < 30: return 30
    elif n < 500: return 50
    elif n < 1300: return 70
    elif n < 2300: return 95
    else: return 120

gdf_yac["radio"] = gdf_yac["num_pozos"].apply(escala_radio)

# --- Seleccionar columnas relevantes ---
gdf_pozos_out = gdf_vm_pozos[[
    "idpozo", "pozo", "yacimiento", "operador", "tipo_empresa",
    "petroleo_m3", "gas_m3", "color", "geometry"
]]

gdf_yac_out = gdf_yac[["yacimiento", "num_pozos", "tipo_dominante", "color", "radio", "geometry"]]

# --- Exportar ---
gdf_pozos_out.to_file("pozos_vm.geojson", driver="GeoJSON")
gdf_yac_out.to_file("yacimientos_vm.geojson", driver="GeoJSON")

print("✅ Archivos generados:")
print(" - pozos_vm.geojson")
print(" - yacimientos_vm.geojson")
