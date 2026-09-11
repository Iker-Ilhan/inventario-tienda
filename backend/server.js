// ===== SERVIDOR BACKEND - SISTEMA DE INVENTARIO CON RELACIONES =====
// Base de datos: proyecto | Servidor: prueba
// Autores: José Vladimir Díaz Nicolas & Iker Ilhan Diaz Pino

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// ===== CONFIGURACIÓN =====
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ===== CONEXIÓN A TU BASE DE DATOS "proyecto" =====
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/inventario';

mongoose.connect(MONGODB_URL)
  .then(() => console.log('✅ ¡Conectado a MongoDB - Base de datos: proyecto!'))
  .catch(err => console.error('❌ Error al conectar:', err));

// ===== MODELOS =====
const Producto = mongoose.model('productos', new mongoose.Schema({}, { strict: false }));
const Venta = mongoose.model('ventas', new mongoose.Schema({}, { strict: false }));
const Cliente = mongoose.model('clientes', new mongoose.Schema({}, { strict: false }));
const Proveedor = mongoose.model('proveedores', new mongoose.Schema({}, { strict: false }));
const HistorialStock = mongoose.model('historial_stock', new mongoose.Schema({}, { strict: false }));

// ========================================
// OPERACIONES DE NEGOCIO REALES
// ========================================

// REGISTRAR VENTA REAL (actualiza stock automáticamente)
app.post('/api/operaciones/venta', async (req, res) => {
  try {
    const { cliente_id, productos_vendidos } = req.body;
    
    if (!productos_vendidos || productos_vendidos.length === 0) {
      return res.status(400).json({ error: 'Debe incluir al menos un producto' });
    }
    
    for (let item of productos_vendidos) {
      const producto = await Producto.findById(item.id_producto);
      if (!producto) {
        return res.status(404).json({ error: `Producto ${item.id_producto} no encontrado` });
      }
      if (producto.stock < item.cantidad) {
        return res.status(400).json({ 
          error: `Stock insuficiente para ${producto.nombre}. Disponible: ${producto.stock}, Solicitado: ${item.cantidad}` 
        });
      }
    }
    
    let total = 0;
    const productosConDetalle = [];
    
    for (let item of productos_vendidos) {
      const producto = await Producto.findById(item.id_producto);
      const subtotal = producto.precio * item.cantidad;
      total += subtotal;
      
      productosConDetalle.push({
        id_producto: producto._id,
        nombre_producto: producto.nombre,
        cantidad: item.cantidad,
        precio_unitario: producto.precio
      });
      
      await Producto.findByIdAndUpdate(producto._id, {
        $inc: { stock: -item.cantidad }
      });
      
      await new HistorialStock({
        id_producto: producto._id,  // Ya es ObjectId
        tipo_movimiento: 'salida',
        cantidad: item.cantidad,
        fecha: new Date(),
        motivo: 'Venta'
      }).save();
    }
    
    // CORRECCIÓN: Convertir cliente_id a ObjectId si existe
    const ventaData = {
      productos_vendidos: productosConDetalle,
      total: total,
      fecha: new Date()
    };
    
    // Solo agregar cliente_id si existe y es válido
    if (cliente_id && mongoose.Types.ObjectId.isValid(cliente_id)) {
      ventaData.cliente_id = new mongoose.Types.ObjectId(cliente_id);
    }
    
     const nuevaVenta = new Venta(ventaData);
    await nuevaVenta.save();
    
    res.json({ 
      mensaje: '✅ Venta registrada exitosamente. Stock actualizado.',
      venta: nuevaVenta,
      total: total
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ENTRADA DE STOCK (compra/reposición)
app.post('/api/operaciones/entrada-stock', async (req, res) => {
  try {
    const { id_producto, cantidad } = req.body;
    
    if (!id_producto || !cantidad || cantidad <= 0) {
      return res.status(400).json({ error: 'Datos inválidos' });
    }
    
    const producto = await Producto.findById(id_producto);
    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    
    await Producto.findByIdAndUpdate(id_producto, {
      $inc: { stock: cantidad }
    });
    
    // CORRECCIÓN: Usar directamente el _id del producto
    await new HistorialStock({
      id_producto: producto._id,  // Ya es ObjectId desde findById
      tipo_movimiento: 'entrada',
      cantidad: cantidad,
      fecha: new Date(),
      motivo: 'Compra a proveedor'
    }).save();
    
    const productoActualizado = await Producto.findById(id_producto);
    
    res.json({ 
      mensaje: `✅ Entrada de stock registrada. Nuevo stock: ${productoActualizado.stock}`,
      producto: productoActualizado
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SALIDA DE STOCK (merma/devolución/pérdida)
app.post('/api/operaciones/salida-stock', async (req, res) => {
  try {
    const { id_producto, cantidad, motivo } = req.body;
    
    if (!id_producto || !cantidad || cantidad <= 0) {
      return res.status(400).json({ error: 'Datos inválidos' });
    }
    
    const producto = await Producto.findById(id_producto);
    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    
    if (producto.stock < cantidad) {
      return res.status(400).json({ 
        error: `Stock insuficiente. Disponible: ${producto.stock}` 
      });
    }
    
    await Producto.findByIdAndUpdate(id_producto, {
      $inc: { stock: -cantidad }
    });
    
    // CORRECCIÓN: Usar directamente el _id del producto
    await new HistorialStock({
      id_producto: producto._id,  // Ya es ObjectId desde findById
      tipo_movimiento: 'salida',
      cantidad: cantidad,
      motivo: motivo || 'Salida manual',
      fecha: new Date()
    }).save();
    
    const productoActualizado = await Producto.findById(id_producto);
    
    res.json({ 
      mensaje: `✅ Salida de stock registrada. Nuevo stock: ${productoActualizado.stock}`,
      producto: productoActualizado
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ========================================
// CRUD - PRODUCTOS (CON RELACIÓN A PROVEEDOR)
// ========================================

app.get('/api/productos', async (req, res) => {
  try {
    const productos = await Producto.aggregate([
      {
        $lookup: {
          from: "proveedores",
          localField: "proveedor",
          foreignField: "_id",
          as: "proveedor_info"
        }
      },
      { $unwind: { path: "$proveedor_info", preserveNullAndEmptyArrays: true } }
    ]);
    res.json(productos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ...
app.get('/api/productos/:id', async (req, res) => {
  try {
    const producto = await Producto.findById(req.params.id);
    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    res.json(producto);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ...

// ...
app.post('/api/productos', async (req, res) => {
  try {
    const data = req.body;
    
    // CORRECCIÓN: Si proveedor existe y no es null/vacío, lo convertimos a ObjectId
    if (data.proveedor && data.proveedor.trim() !== '') {
      data.proveedor = new mongoose.Types.ObjectId(data.proveedor);
    } else {
      data.proveedor = null;
    }
    
    const nuevoProducto = new Producto(data);
    await nuevoProducto.save();
    res.json({ mensaje: '✅ Producto creado exitosamente', producto: nuevoProducto });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ...

// ...
app.put('/api/productos/:id', async (req, res) => {
  try {
    const data = req.body;
    
    // CORRECCIÓN: Si proveedor existe y no es null/vacío, lo convertimos a ObjectId
    if (data.proveedor && data.proveedor.trim() !== '') {
      data.proveedor = new mongoose.Types.ObjectId(data.proveedor);
    } else if (data.proveedor === '') {
      // Si se envía como cadena vacía (lo que hace el frontend al deseleccionar), forzamos null
      data.proveedor = null;
    }
    
    const productoActualizado = await Producto.findByIdAndUpdate(
      req.params.id,
      data, // Usamos 'data' ya modificado
      { new: true, runValidators: true }
    );
    if (!productoActualizado) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    res.json({ mensaje: '✅ Producto actualizado exitosamente', producto: productoActualizado });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ...

app.delete('/api/productos/:id', async (req, res) => {
  try {
    const productoEliminado = await Producto.findByIdAndDelete(req.params.id);
    if (!productoEliminado) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    res.json({ mensaje: '✅ Producto eliminado exitosamente', producto: productoEliminado });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// CRUD - CLIENTES
// ========================================

app.get('/api/clientes', async (req, res) => {
  try {
    const clientes = await Cliente.find();
    res.json(clientes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clientes/:id', async (req, res) => {
  try {
    const cliente = await Cliente.findById(req.params.id);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    res.json(cliente);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/clientes', async (req, res) => {
  try {
    const nuevoCliente = new Cliente(req.body);
    await nuevoCliente.save();
    res.json({ mensaje: '✅ Cliente creado exitosamente', cliente: nuevoCliente });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/clientes/:id', async (req, res) => {
  try {
    const clienteActualizado = await Cliente.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!clienteActualizado) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    res.json({ mensaje: '✅ Cliente actualizado exitosamente', cliente: clienteActualizado });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/clientes/:id', async (req, res) => {
  try {
    const clienteEliminado = await Cliente.findByIdAndDelete(req.params.id);
    if (!clienteEliminado) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    res.json({ mensaje: '✅ Cliente eliminado exitosamente', cliente: clienteEliminado });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// CRUD - VENTAS (CON RELACIÓN A CLIENTE)
// ========================================

app.get('/api/ventas', async (req, res) => {
  try {
    const ventas = await Venta.aggregate([
      {
        $lookup: {
          from: "clientes",
          localField: "cliente_id",
          foreignField: "_id",
          as: "cliente_info"
        }
      },
      { $unwind: { path: "$cliente_info", preserveNullAndEmptyArrays: true } },
      { $sort: { fecha: -1 } }
    ]);
    res.json(ventas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/ventas/:id', async (req, res) => {
  try {
    const venta = await Venta.findById(req.params.id);
    if (!venta) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    res.json(venta);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/ventas/:id', async (req, res) => {
  try {
    const ventaEliminada = await Venta.findByIdAndDelete(req.params.id);
    if (!ventaEliminada) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    res.json({ mensaje: '✅ Venta eliminada exitosamente', venta: ventaEliminada });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// CRUD - PROVEEDORES
// ========================================

app.get('/api/proveedores', async (req, res) => {
  try {
    const proveedores = await Proveedor.find();
    res.json(proveedores);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/proveedores/:id', async (req, res) => {
  try {
    const proveedor = await Proveedor.findById(req.params.id);
    if (!proveedor) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }
    res.json(proveedor);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/proveedores', async (req, res) => {
  try {
    const nuevoProveedor = new Proveedor(req.body);
    await nuevoProveedor.save();
    res.json({ mensaje: '✅ Proveedor creado exitosamente', proveedor: nuevoProveedor });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/proveedores/:id', async (req, res) => {
  try {
    const proveedorActualizado = await Proveedor.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!proveedorActualizado) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }
    res.json({ mensaje: '✅ Proveedor actualizado exitosamente', proveedor: proveedorActualizado });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/proveedores/:id', async (req, res) => {
  try {
    const proveedorEliminado = await Proveedor.findByIdAndDelete(req.params.id);
    if (!proveedorEliminado) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }
    res.json({ mensaje: '✅ Proveedor eliminado exitosamente', proveedor: proveedorEliminado });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// CONSULTAS CON RELACIONES
// ========================================

// PRODUCTOS DISPONIBLES (con proveedor)
app.get('/api/consultas/productos-disponibles', async (req, res) => {
  try {
    const resultado = await Producto.aggregate([
      { $match: { stock: { $gt: 0 } } },
      {
        $lookup: {
          from: "proveedores",
          localField: "proveedor",
          foreignField: "_id",
          as: "proveedor_info"
        }
      },
      { $unwind: { path: "$proveedor_info", preserveNullAndEmptyArrays: true } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/productos-categoria/:categoria', async (req, res) => {
  try {
    const resultado = await Producto.aggregate([
      { $match: { categoria: req.params.categoria } },
      {
        $lookup: {
          from: "proveedores",
          localField: "proveedor",
          foreignField: "_id",
          as: "proveedor_info"
        }
      },
      { $unwind: { path: "$proveedor_info", preserveNullAndEmptyArrays: true } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/productos-stock-bajo', async (req, res) => {
  try {
    const resultado = await Producto.aggregate([
      { $match: { stock: { $lt: 20 } } },
      {
        $lookup: {
          from: "proveedores",
          localField: "proveedor",
          foreignField: "_id",
          as: "proveedor_info"
        }
      },
      { $unwind: { path: "$proveedor_info", preserveNullAndEmptyArrays: true } },
      { $sort: { stock: 1 } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/productos-caros', async (req, res) => {
  try {
    const resultado = await Producto.aggregate([
      { $match: { precio: { $gte: 50 } } },
      {
        $lookup: {
          from: "proveedores",
          localField: "proveedor",
          foreignField: "_id",
          as: "proveedor_info"
        }
      },
      { $unwind: { path: "$proveedor_info", preserveNullAndEmptyArrays: true } },
      { $sort: { precio: -1 } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/productos-buscar/:nombre', async (req, res) => {
  try {
    const resultado = await Producto.aggregate([
      { 
        $match: { 
          nombre: { $regex: req.params.nombre, $options: "i" } 
        }
      },
      {
        $lookup: {
          from: "proveedores",
          localField: "proveedor",
          foreignField: "_id",
          as: "proveedor_info"
        }
      },
      { $unwind: { path: "$proveedor_info", preserveNullAndEmptyArrays: true } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/productos-por-categoria', async (req, res) => {
  try {
    const resultado = await Producto.aggregate([
      { $group: { _id: "$categoria", total_productos: { $sum: 1 } } },
      { $sort: { total_productos: -1 } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// VENTAS DE HOY (con cliente)
app.get('/api/consultas/ventas-hoy', async (req, res) => {
  try {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);
    
    const resultado = await Venta.aggregate([
      { 
        $match: { 
          fecha: { $gte: hoy, $lt: manana, $exists: true, $ne: null }
        }
      },
      {
        $lookup: {
          from: "clientes",
          localField: "cliente_id",
          foreignField: "_id",
          as: "cliente_info"
        }
      },
      { $unwind: { path: "$cliente_info", preserveNullAndEmptyArrays: true } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/ventas-por-dia', async (req, res) => {
  try {
    const resultado = await Venta.aggregate([
      { $match: { fecha: { $exists: true, $ne: null, $type: "date" } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$fecha" } },
          total_ventas: { $sum: "$total" },
          numero_transacciones: { $sum: 1 }
        }
      },
      { $sort: { _id: -1 } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/productos-mas-vendidos', async (req, res) => {
  try {
    const resultado = await Venta.aggregate([
      { $unwind: "$productos_vendidos" },
      {
        $group: {
          _id: "$productos_vendidos.nombre_producto",
          total_vendido: { $sum: "$productos_vendidos.cantidad" },
          ingresos_generados: { 
            $sum: { 
              $multiply: ["$productos_vendidos.cantidad", "$productos_vendidos.precio_unitario"] 
            } 
          }
        }
      },
      { $sort: { total_vendido: -1 } },
      { $limit: 10 }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/ventas-por-categoria', async (req, res) => {
  try {
    const resultado = await Venta.aggregate([
      { $unwind: "$productos_vendidos" },
      {
        $lookup: {
          from: "productos",
          localField: "productos_vendidos.id_producto",
          foreignField: "_id",
          as: "producto_info"
        }
      },
      { $unwind: "$producto_info" },
      {
        $group: {
          _id: "$producto_info.categoria",
          total_vendido: { $sum: "$productos_vendidos.cantidad" },
          ingresos: { 
            $sum: { 
              $multiply: ["$productos_vendidos.cantidad", "$productos_vendidos.precio_unitario"] 
            } 
          }
        }
      },
      { $sort: { ingresos: -1 } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/clientes-top', async (req, res) => {
  try {
    const resultado = await Venta.aggregate([
      {
        $lookup: {
          from: "clientes",
          localField: "cliente_id",
          foreignField: "_id",
          as: "cliente_info"
        }
      },
      { $unwind: "$cliente_info" },
      {
        $group: {
          _id: "$cliente_info.nombre",
          email: { $first: "$cliente_info.email" },
          total_gastado: { $sum: "$total" },
          numero_compras: { $sum: 1 }
        }
      },
      { $sort: { total_gastado: -1 } },
      { $limit: 10 }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/productos-reposicion', async (req, res) => {
  try {
    const resultado = await Producto.aggregate([
      { $match: { stock: { $lt: 25 } } },
      {
        $lookup: {
          from: "proveedores",
          localField: "proveedor",
          foreignField: "_id",
          as: "proveedor_info"
        }
      },
      { $unwind: { path: "$proveedor_info", preserveNullAndEmptyArrays: true } },
      { $sort: { stock: 1 } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/valor-inventario', async (req, res) => {
  try {
    const resultado = await Producto.aggregate([
      {
        $group: {
          _id: null,
          valor_total_inventario: { $sum: { $multiply: ["$precio", "$stock"] } },
          total_productos: { $sum: 1 },
          total_unidades: { $sum: "$stock" }
        }
      }
    ]);
    res.json(resultado[0] || { valor_total_inventario: 0, total_productos: 0, total_unidades: 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/inventario-por-categoria', async (req, res) => {
  try {
    const resultado = await Producto.aggregate([
      {
        $group: {
          _id: "$categoria",
          total_productos: { $sum: 1 },
          total_unidades: { $sum: "$stock" },
          valor_categoria: { $sum: { $multiply: ["$precio", "$stock"] } }
        }
      },
      { $sort: { valor_categoria: -1 } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/productos-sin-stock', async (req, res) => {
  try {
    const resultado = await Producto.aggregate([
      { $match: { stock: 0 } },
      {
        $lookup: {
          from: "proveedores",
          localField: "proveedor",
          foreignField: "_id",
          as: "proveedor_info"
        }
      },
      { $unwind: { path: "$proveedor_info", preserveNullAndEmptyArrays: true } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/productos-por-proveedor', async (req, res) => {
  try {
    const resultado = await Producto.aggregate([
      {
        $lookup: {
          from: "proveedores",
          localField: "proveedor",
          foreignField: "_id",
          as: "proveedor_info"
        }
      },
      { $unwind: "$proveedor_info" },
      {
        $group: {
          _id: "$proveedor_info.nombre_empresa",
          productos_suministrados: { $sum: 1 },
          valor_inventario_proveedor: { $sum: { $multiply: ["$precio", "$stock"] } }
        }
      },
      { $sort: { productos_suministrados: -1 } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/productos-con-proveedor', async (req, res) => {
  try {
    const resultado = await Producto.aggregate([
      {
        $lookup: {
          from: "proveedores",
          localField: "proveedor",
          foreignField: "_id",
          as: "proveedor_info"
        }
      },
      { $unwind: { path: "$proveedor_info", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          nombre: 1,
          precio: 1,
          stock: 1,
          categoria: 1,
          "proveedor_info.nombre_empresa": 1,
          "proveedor_info.contacto": 1
        }
      }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/movimientos-recientes', async (req, res) => {
  try {
    const resultado = await HistorialStock.aggregate([
      {
        $lookup: {
          from: "productos",
          localField: "id_producto",
          foreignField: "_id",
          as: "producto_info"
        }
      },
      { $unwind: { path: "$producto_info", preserveNullAndEmptyArrays: true } },
      { $sort: { fecha: -1 } },
      { $limit: 20 }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/entradas-salidas', async (req, res) => {
  try {
    const resultado = await HistorialStock.aggregate([
      { $match: { fecha: { $exists: true, $ne: null, $type: "date" } } },
      {
        $group: {
          _id: {
            fecha: { $dateToString: { format: "%Y-%m-%d", date: "$fecha" } },
            tipo: "$tipo_movimiento"
          },
          total_cantidad: { $sum: "$cantidad" }
        }
      },
      { $sort: { "_id.fecha": -1 } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/ticket-promedio', async (req, res) => {
  try {
    const resultado = await Venta.aggregate([
      {
        $group: {
          _id: null,
          ticket_promedio: { $avg: "$total" },
          venta_maxima: { $max: "$total" },
          venta_minima: { $min: "$total" }
        }
      }
    ]);
    res.json(resultado[0] || { ticket_promedio: 0, venta_maxima: 0, venta_minima: 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/productos-no-vendidos', async (req, res) => {
  try {
    const resultado = await Producto.aggregate([
      {
        $lookup: {
          from: "ventas",
          let: { producto_id: "$_id" },
          pipeline: [
            { $unwind: "$productos_vendidos" },
            { $match: { $expr: { $eq: ["$productos_vendidos.id_producto", "$$producto_id"] } } }
          ],
          as: "ventas_producto"
        }
      },
      { $match: { ventas_producto: { $size: 0 } } },
      {
        $lookup: {
          from: "proveedores",
          localField: "proveedor",
          foreignField: "_id",
          as: "proveedor_info"
        }
      },
      { $unwind: { path: "$proveedor_info", preserveNullAndEmptyArrays: true } },
      { $project: { nombre: 1, precio: 1, stock: 1, categoria: 1, proveedor_info: 1 } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/ventas-por-hora', async (req, res) => {
  try {
    const resultado = await Venta.aggregate([
      { $match: { fecha: { $exists: true, $ne: null, $type: "date" } } },
      {
        $group: {
          _id: { $hour: "$fecha" },
          ventas_totales: { $sum: "$total" },
          numero_transacciones: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/productos-rotacion', async (req, res) => {
  try {
    const resultado = await Producto.aggregate([
      {
        $lookup: {
          from: "ventas",
          let: { producto_id: "$_id" },
          pipeline: [
            { $unwind: "$productos_vendidos" },
            { $match: { $expr: { $eq: ["$productos_vendidos.id_producto", "$$producto_id"] } } },
            { $group: { _id: null, total_vendido: { $sum: "$productos_vendidos.cantidad" } } }
          ],
          as: "ventas_info"
        }
      },
      {
        $addFields: {
          total_vendido: { $ifNull: [{ $arrayElemAt: ["$ventas_info.total_vendido", 0] }, 0] },
          rotacion: {
            $cond: {
              if: { $gt: ["$stock", 0] },
              then: { $divide: [{ $ifNull: [{ $arrayElemAt: ["$ventas_info.total_vendido", 0] }, 0] }, "$stock"] },
              else: 0
            }
          }
        }
      },
      {
        $lookup: {
          from: "proveedores",
          localField: "proveedor",
          foreignField: "_id",
          as: "proveedor_info"
        }
      },
      { $unwind: { path: "$proveedor_info", preserveNullAndEmptyArrays: true } },
      { $sort: { rotacion: -1 } },
      { $project: { nombre: 1, stock: 1, total_vendido: 1, rotacion: 1, categoria: 1, proveedor_info: 1 } },
      { $limit: 20 }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/cliente-email/:email', async (req, res) => {
  try {
    const resultado = await Cliente.findOne({ email: req.params.email });
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/clientes-por-ciudad', async (req, res) => {
  try {
    const resultado = await Cliente.aggregate([
      {
        $addFields: {
          ciudad: {
            $arrayElemAt: [
              { $split: ["$direccion", ","] },
              -1
            ]
          }
        }
      },
      {
        $group: {
          _id: { $trim: { input: "$ciudad" } },
          total_clientes: { $sum: 1 }
        }
      },
      { $sort: { total_clientes: -1 } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/resumen-general', async (req, res) => {
  try {
    const resultado = await Venta.aggregate([
      {
        $facet: {
          "ventas_totales": [
            { $group: { _id: null, total: { $sum: "$total" }, transacciones: { $sum: 1 } } }
          ],
          "productos_vendidos": [
            { $unwind: "$productos_vendidos" },
            { $group: { _id: null, unidades_vendidas: { $sum: "$productos_vendidos.cantidad" } } }
          ],
          "ticket_promedio": [
            { $group: { _id: null, promedio: { $avg: "$total" } } }
          ]
        }
      }
    ]);
    res.json(resultado[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/top-ingresos', async (req, res) => {
  try {
    const resultado = await Venta.aggregate([
      { $unwind: "$productos_vendidos" },
      {
        $group: {
          _id: "$productos_vendidos.nombre_producto",
          ingresos_totales: {
            $sum: { $multiply: ["$productos_vendidos.cantidad", "$productos_vendidos.precio_unitario"] }
          },
          unidades_vendidas: { $sum: "$productos_vendidos.cantidad" }
        }
      },
      { $sort: { ingresos_totales: -1 } },
      { $limit: 5 }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/ventas-por-semana', async (req, res) => {
  try {
    const resultado = await Venta.aggregate([
      { $match: { fecha: { $exists: true, $ne: null, $type: "date" } } },
      {
        $group: {
          _id: { $week: "$fecha" },
          ventas_semanales: { $sum: "$total" },
          transacciones: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/consultas/todas-colecciones', async (req, res) => {
  try {
    const [productos, ventas, clientes, proveedores, historial] = await Promise.all([
      Producto.countDocuments(),
      Venta.countDocuments(),
      Cliente.countDocuments(),
      Proveedor.countDocuments(),
      HistorialStock.countDocuments()
    ]);
    
    res.json({
      productos: productos,
      ventas: ventas,
      clientes: clientes,
      proveedores: proveedores,
      historial_stock: historial
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== INICIAR SERVIDOR =====
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║  🚀 SERVIDOR CORRIENDO                 ║
  ║  📍 http://localhost:${PORT}              ║
  ║  💾 Base de datos: proyecto            ║
  ║  👨‍💻 Servidor: prueba                    ║
  ║  ✏️  CRUD + OPERACIONES REALES         ║
  ║  🔗 CON RELACIONES ($lookup)           ║
  ║  🛑 Presiona CTRL+C para detener       ║
  ╚═══════════════════════════════════════╝
  `);
});
