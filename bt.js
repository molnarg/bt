;(function (root, factory) {
  if (typeof exports === 'object') {
    module.exports = factory()

  } else if (typeof define === 'function' && define.amd) {
    define(factory)

  } else {
    root.bt = factory()
  }

}(this, function () {
  'use strict'

  if (typeof Buffer !== 'undefined') Object.defineProperties(Buffer.prototype, {
    getUint8 : { value: Buffer.prototype.readUInt8 },
    getUint16: { value: function(offset, littleEndian) {
      return littleEndian ? this.readUInt16LE(offset) : this.readUInt16BE(offset)
    } },
    getUint32: { value: function(offset, littleEndian) {
      return littleEndian ? this.readUInt32LE(offset) : this.readUInt32BE(offset)
    } },

    setUint8 : { value: function(offset, value) {
      this.writeUInt8(value, offset)
    } },
    setUint16: { value: function(offset, value, littleEndian) {
      littleEndian ? this.writeUInt16LE(value, offset) : this.writeUInt16BE(value, offset)
    } },
    setUint32: { value: function(offset, value, littleEndian) {
      littleEndian ? this.writeUInt32LE(value, offset) : this.writeUInt32BE(value, offset)
    } }
  })

  function View(parent, offset) {
    if (typeof parent === 'number') parent = (typeof Buffer === 'undefined') ? new DataView(new ArrayBuffer(parent))
                                                                             : new Buffer(parent)
    this.parent = parent
    this.offset = offset || 0
  }

  // Bitmasks with j leading 1s
  var ones = []
  for (var j = 1; j <= 32; j++) ones[j] = (1 << j) - 1

  Object.defineProperties(View.prototype, {
    root: { get: function() {
      var parent = this.parent
      while (parent.parent) parent = parent.parent
      return parent
    }},

    root_offset: { get: function() {
      var view = this, offset = this.offset || 0
      while (view = view.parent) offset += view.offset || 0
      return offset
    }},

    getUint: { value: function getUint(bit_length, offset, little_endian) {
      offset += this.root_offset

      // Shortcut for built-in read methods
      if (offset % 1 === 0) {
        switch(bit_length) {
          case 8 : return this.root.getUint8 (offset, little_endian)
          case 16: return this.root.getUint16(offset, little_endian)
          case 32: return this.root.getUint32(offset, little_endian)
        }
      }

      var byte_offset = Math.floor(offset)
        , bit_offset = (offset % 1) * 8
        , back_offset = 32 - bit_length - bit_offset

      if (back_offset < 0) {
        var overflow = -back_offset
        return (this.getUint(bit_length - overflow, offset) << overflow) +
               (this.getUint(overflow, byte_offset + 4))

      } else {
        return (this.root.getUint32(byte_offset) >> back_offset) & ones[bit_length]
      }
    }},

    setUint: { value: function setUint(bit_length, offset, value, little_endian) {
      offset += this.root_offset

      // Shortcut for built-in write methods
      if (offset % 1 === 0 && (bit_length === 8 || bit_length === 16 || bit_length === 32)) {
        this.root['setUint' + bit_length](offset, value, little_endian)
      }

      var byte_offset = Math.floor(offset)
        , bit_offset = (offset % 1) * 8
        , back_offset = 32 - bit_length - bit_offset

      if (back_offset < 0) {
        var overflow = -back_offset
        this.setUint(bit_length - overflow, offset, value >> overflow)
        this.setUint(overflow, byte_offset + 4, value & ones[overflow])

      } else {
        var one_mask = value << back_offset
          , zero_mask = one_mask | ones[back_offset] | (ones[bit_offset] << bit_length + back_offset)
        this.root.setUint32(byte_offset, this.root.getUint32(byte_offset) & zero_mask | one_mask)
      }
    }}
  })

  function declareAccessorFunctions(bit_length) {
    View.prototype['getUint' + bit_length] = function(offset, little_endian) {
      return this.getUint(bit_length, offset, little_endian)
    }

    View.prototype['setUint' + bit_length] = function(offset, value, little_endian) {
      this.setUint(bit_length, offset, value, little_endian)
    }
  }

  for (var length = 1; length <= 32; length++) declareAccessorFunctions(length)


  // Return null if runtime property, and the constant value otherwise
  function propertyExpression(object, name, expression) {
    if (!expression) return undefined

    var descriptor
    if (typeof expression === 'string') {
      // anonymous function-like string
      descriptor = { get: new Function('with(this) { return ' + expression + '}') }

      // if it is a reference to a property, then it is possible to generate a setter as well
      if (expression.match(/^[0-9a-zA-Z_$.]*$/)) {
        descriptor.set = new Function('value', 'with(this) { ' + expression + ' = value }')
      }

    } else if (typeof expression === 'number' || typeof expression === 'boolean') {
      // explicitly given number
      descriptor = { value: expression }

    } else if (expression instanceof Function) {
      var properties = Object.getOwnPropertyNames(expression.prototype)
      if (properties.length === 1 && properties[0] === 'constructor') {
        // expression is an anonymous function that returns the class
        descriptor = { get: expression }

      } else {
        // expression is a constructor function
        descriptor = { value: expression }
      }
    }

    // Simplifying if possible (if there's no reference error)
    if (descriptor.get) {
      try {
        descriptor = { value: descriptor.get.call(Object.create(object)) }
      } catch(e) {
        if (!(e instanceof TypeError)) throw e
      }
    }

    descriptor.configurable = true

    Object.defineProperty(object, name, descriptor)

    return ('value' in descriptor) ? descriptor.value : null
  }

  function Template(parent, offset) {
    View.call(this, parent, offset)
  }

  Template.prototype = Object.create(View.prototype, {
    __size_undefined: { value: 0 },
    __offset_undefined: { value: 0 },

    size: { get: function() {
      return this['__offset_' + this.__last] + (this['__size_' + this.__last] || 0)
    }},

    valueOf: { value: function() {
      var size = this.size
      return (size <= 4) ? this['getUint' + size * 8](0) : undefined
    }},

    set: { value: function(values) {
      if (typeof values === 'object') {
        for (var key in values) {
          this[key] = values[key]
        }

      } else if (typeof values === 'number' && this.size <= 4) {
        this['setUint' + (this.size * 8)](0, values)
      }
    }}
  })

  Template.defineProperty = function(object, name, desc) {
    if (desc instanceof Array) {
      defineParallelProperties(object, name, desc)

    } else if (typeof desc === 'function' || (typeof desc === 'object' && desc.view instanceof Function)) {
      defineTypedProperty(object, name, desc)

    } else if (typeof desc === 'number' || 'size' in desc || 'offset' in desc) {
      defineBitfieldProperty(object, name, desc)

    } else if ('array' in desc) {
      defineArrayProperty(object, name, desc)

    } else if ('value' in desc || 'get' in desc || 'set' in desc) {
      Object.defineProperty(object, name, desc)

    } else {
      defineNestedProperties(object, name, desc)
    }
  }

  Template.defineProperties = function(object, properties) {
    var names = properties._order || Object.keys(properties)

    for (var i = 0; i < names.length; i++) {
      var name = names[i]
      Template.defineProperty(object, name, properties[name])
    }
  }

  Template.create = function(prototype, descriptor) {
    var structure = Object.create(prototype)

    Template.defineProperties(structure, descriptor)

    return structure
  }

  Template.extend = function(structure) {
    var ParentClass = this

    var TemplateClass = structure.init || function TemplateClass(parent, offset) {
      ParentClass.call(this, parent, offset)
    }
    delete structure.init

    TemplateClass.structure = structure
    TemplateClass.extend = Template.extend

    TemplateClass.prototype = Template.create(ParentClass.prototype, structure)

    return TemplateClass
  }

  function wrapWithClosure(source, closure) {
    var closure_keys = Object.keys(closure)
      , closure_arguments = closure_keys.map(function(key) { return closure[key] })

    return Function.apply(null, closure_keys.concat('return ' + source)).apply(null, closure_arguments)
  }

  function defineBitfieldProperty(object, name, desc) {
    if (!(desc instanceof Object)) desc = { size: desc }

    var offset_prop = '__offset_' + name
      , size_prop = '__size_' + name
      , le_prop = '__le_' + name

      , prev_offset = '__offset_' + object.__last
      , prev_size = '__size_' + object.__last

      , offset = propertyExpression(object, offset_prop, desc.offset || function() { return this[prev_offset] + this[prev_size] })
      , size   = propertyExpression(object, size_prop  , desc.size)
      , le     = propertyExpression(object, le_prop    , desc.little_endian)

    // Getter
    var getter_name = 'get_' + name
      , getter_closure = {}
      , getter_src = 'var value = this.getUint({size}, {offset}, {le});'
        .replace('{offset}', offset === null ? ('this.' + offset_prop       ) : offset)
        .replace('{size}'  , size   === null ? ('this.' + size_prop + ' * 8') : size * 8)
        .replace('{le}'    , le     === null ? ('this.' + le_prop           ) : le)

    if (desc.domain) {
      getter_src += 'if (value in domain) value = domain[value];'
      getter_closure.domain = desc.domain

    } else if (desc.size === 1/8) {
      getter_src += 'value = Boolean(value);'
    }

    if (desc.assert) {
      getter_closure.assert = desc.assert
      getter_src += 'assert.call(this, value);'
    }

    var getter = wrapWithClosure('function ' + getter_name + '() { ' + getter_src + ' return value; }', getter_closure)


    // Setter
    var setter_name = 'set_' + name
      , setter_closure = {}
      , setter_src = 'this.setUint({size}, {offset}, value, {le});'
        .replace('{offset}', offset === null ? ('this.' + offset_prop       ) : offset)
        .replace('{size}'  , size   === null ? ('this.' + size_prop + ' * 8') : size * 8)
        .replace('{le}'    , le     === null ? ('this.' + le_prop           ) : le)

    if (desc.assert) {
      setter_closure.assert = desc.assert
      setter_src = 'assert.call(this, value);' + setter_src
    }

    if (desc.domain) {
      setter_closure.reverse_domain = {}
      for (var n in desc.domain) setter_closure.reverse_domain[desc.domain[n]] = Number(n)
      setter_src = 'if (value in reverse_domain) value = reverse_domain[value];' + setter_src

    } else if (desc.size === 1/8) {
      setter_src = 'value = value ? 1 : 0;' + setter_src
    }

    var setter = wrapWithClosure('function ' + setter_name + '(value) { ' + setter_src + ' }', setter_closure)

    // Defining the property
    Object.defineProperty(object, name, { get: getter, set: setter, enumerable: true })

    object.__last = name
  }

  function defineTypedProperty(object, name, desc) {
    if (typeof desc === 'function') desc = { view: desc }

    var offset = '__offset_' + name, size = '__size_' + name, type = '__type_' + name
      , prev_offset = '__offset_' + object.__last, prev_size = '__size_' + object.__last

    var buildtime_offset = propertyExpression(object, offset, desc.offset || function() { return this[prev_offset] + this[prev_size] })
    var buildtime_view   = propertyExpression(object, type, desc.view)

    var getter = new Function('return new this.' + type + '(this, this.' + offset + ')')
    var setter = new Function('value', 'var object = this.' + name + '\n if (object.set) object.set(value)')

    Object.defineProperty(object, name, { get: getter, set: setter })

    try {
      var prototype_size = Object.create(buildtime_view.prototype).size
    } catch (e) {
      // There's no buildtime information about the type, or it has no buildtime length property
    }
    propertyExpression(object, size, desc.size || prototype_size || function() { return this[name].size })

    object.__last = name
  }

  function defineParallelProperties(object, name, properties) {
    var previous = object.__last

    for (var i = 0; i < properties.length; i++) {
      object.__last = previous
      Template.defineProperties(object, properties[i])
    }
  }

  function defineArrayProperty(object, name, desc) {
    var ListType = List.extend(desc)

    defineTypedProperty(object, name, ListType)
  }

  function defineNestedProperties(object, name, desc) {
    if (!desc.__view) {
      var prototype = Template.create(Template.prototype, desc)
      desc.__view = function NestedStructure(parent, offset) { Template.call(this, parent, offset) }
      desc.__view.prototype = prototype
    }

    defineTypedProperty(object, name, { view: desc.__view })
  }



  function List(parent, offset) {
    Template.call(this, parent, offset)
  }

  List.prototype = Object.create(Template.prototype, {
    last: { get: function getLast() {
      var last
      this.forEach(function(item) { last = item })
      return last
    }},

    size: { get: function getSize() {
      this.forEach(function() {})
      return this.next.offset
    }},

    length: { get: function getLength() {
      var length = 0
      this.forEach(function() { length += 1 })
      return length
    }},

    set: { value: function setArray(array) {
      var self
      this.forEach(function(item, i) {
        self.item = array[i]
      })
    }},

    getItem: { value: function getItem(index) {
      var item
      this.forEach(function(current_item, i) {
        if (i === index) {
          item = current_item
          return false
        }
      })
      return item
    }},

    setItem: { value: function setItem(index, value) {
      var self = this
      this.forEach(function(current_item, i) {
        if (i === index) {
          self.item = value
          return false
        }
      })
    }},

    forEach: { value: function forEach(callback) {
      // Stepping with this.item, and passing inherited objects with fixed offset to callback
      this.__offset_item = 0
      this.next = this.item
      Object.defineProperties(this, {
        length: { value: 0        , writable: true, configurable: true },
        size:   { value: 0        , writable: true, configurable: true },
        last:   { value: undefined, writable: true, configurable: true }
      })

      while (!this.until()) {
        this.last = this.next
        this.length += 1
        this.size += (typeof this.last === 'object') ? this.last.size : this.__size_item

        var cont = callback(this.last, this.length - 1)
        if (cont === false) break

        this.__offset_item = this.size
        this.next = this.item
      }

      delete this.length
      delete this.size
      delete this.last
    }}
  })

  function defineDummyAccessor(object, index) {
    Object.defineProperty(object, index, {
      get: function() { return this.getItem(index) },
      set: function(value) { this.setItem(index, value) }
    })
  }

  for (var i = 0; i < 2000; i++) defineDummyAccessor(List.prototype, i)

  List.extend = function(options) {
    // Default until function: go as far as possible
    if (!options.until && !options.length) options.until = function() {
      try {
        // Stop if the end of the array would be beyond the end of the buffer
        return this.root_offset + this.size + this.next.size > (this.root.length || this.root.byteLength)

      } catch (e) {
        if (e.name !== 'AssertionError' && e.name !== 'INDEX_SIZE_ERR') throw e
        // If e is 'AssertionError: Trying to read beyond buffer length' then stop
        return true
      }
    }

    function TypedList(parent, offset) {
      List.call(this, parent, offset)
    }

    var structure = {
      until: { value: options.until, configurable: true },
      close: { value: options.close, configurable: true },
      item: options.array
    }

    TypedList.prototype = Template.create(List.prototype, structure)
    delete TypedList.prototype.__last
    delete TypedList.prototype.__offset_item

    if (options.length) {
      propertyExpression(TypedList.prototype, 'length', options.length)
      Object.defineProperty(TypedList.prototype, 'close', { value: function() {
        var length = this.length
        delete this.length
        this.length = length
      }})
    }

    return TypedList
  }


  return {
    View: View,
    Template: Template,
    List: List
  }
}))
