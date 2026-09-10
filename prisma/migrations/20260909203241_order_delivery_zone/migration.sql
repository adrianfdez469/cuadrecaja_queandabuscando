-- F-042 R21/AD6: dos columnas de texto, anulables, SIN clave ajena y sin
-- índice. Un pedido es un documento histórico y no puede depender del
-- estado presente de una tabla de referencia (AD6); el código se valida
-- contra el conjunto ofrecible antes de llegar aquí, no contra una FK.
ALTER TABLE "Order" ADD COLUMN     "deliveryZoneCode" TEXT,
ADD COLUMN     "deliveryZoneName" TEXT;
