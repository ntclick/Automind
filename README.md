# AutoMind - AI Reply for X/Twitter

🚀 **Extension tạo comment AI thông minh cho Twitter/X với giao diện hiện đại và danh sách model đầy đủ**

## ✨ Tính năng mới

### 🎨 UI/UX được cải thiện
- **Giao diện hiện đại** với animations mượt mà
- **Loading states** với feedback trực quan
- **Haptic feedback** cho các tương tác
- **Responsive design** cho mọi kích thước màn hình
- **Color-coded status** và progress bars

### 🤖 AI Integration
- **Multiple AI Providers**: OpenAI, Claude, Gemini, Local APIs
- **Smart Comment Generation**: Context-aware responses
- **Tone Customization**: Professional, Casual, Sarcastic, Witty, Concise

### 🔧 Cải thiện lưu/load dữ liệu
- **Async/await** cho tất cả operations
- **Error handling** toàn diện
- **Parallel loading** cho performance tốt hơn
- **Validation** dữ liệu trước khi lưu
- **Fallback mechanisms** khi có lỗi

## 🚀 Cài đặt

### 🔧 Manual Installation (Development)

Chỉ dành cho developers:

```bash
git clone <repository-url>
cd ai-reply-generator
```

**Load extension vào Chrome**:
- Mở Chrome và vào `chrome://extensions/`
- Bật "Developer mode"
- Click "Load unpacked" và chọn thư mục extension

**Cấu hình API Key**:
- Click vào icon extension
- Click "Setup API Key"
- Chọn provider và nhập API key

## 🎯 Cách sử dụng

### 1. Cấu hình API Key
- Chọn AI provider (OpenAI, Claude, Gemini, Local)
- Nhập API key tương ứng
- Test kết nối để đảm bảo hoạt động

### 2. Chọn Tone
- **Professional**: Chuyên nghiệp
- **Casual**: Thân thiện
- **Sarcastic**: Mỉa mai
- **Witty**: Thông minh
- **Concise**: Ngắn gọn

### 3. Sử dụng trên Twitter/X
- Vào Twitter/X
- Extension sẽ tự động inject buttons
- Click vào button AI để tạo comment
- Chọn tone và copy comment

## 🔧 Cấu hình nâng cao

### API Keys
```javascript
// OpenAI
OPENAI_API_KEY=sk-...

// Claude
CLAUDE_API_KEY=sk-ant-...

// Gemini
GEMINI_API_KEY=AIza...

// Local (nếu có)
LOCAL_ENDPOINT=http://localhost:8000
```

### Settings
- **Daily Quota**: Giới hạn số lần sử dụng mỗi ngày
- **Auto-inject**: Tự động hiển thị buttons
- **Language**: Tự động detect ngôn ngữ
- **Notifications**: Thông báo khi hoàn thành

## 📊 Monitoring

### Usage Statistics
- **Daily Usage**: Số lần sử dụng hôm nay
- **Total Usage**: Tổng số lần sử dụng
- **Quota Status**: Trạng thái quota
- **Model Performance**: Hiệu suất của từng model

### Error Handling
- **Network Errors**: Tự động retry
- **API Errors**: Hiển thị thông báo lỗi chi tiết
- **Quota Exceeded**: Thông báo khi hết quota
- **Invalid API Key**: Hướng dẫn cấu hình lại

## 🎨 UI Features

### Popup Interface
- **Real-time stats** với animations
- **Model selection** trực quan
- **Quick settings** với toggles
- **Status indicators** với màu sắc

### Options Page
- **API Key configuration**
- **Tone selection** với descriptions
- **Language preferences**

### Visual Indicators
- **✅ Active**: Extension hoạt động
- **⚠️ Warning**: Cần cấu hình API key
- **❌ Error**: Lỗi kết nối
- **📊 Usage**: Thống kê sử dụng

## 🔒 Privacy & Security

- **Local Storage**: Dữ liệu được lưu locally
- **No Data Collection**: Không thu thập dữ liệu cá nhân
- **API Key Security**: Keys được mã hóa
- **HTTPS Only**: Chỉ kết nối HTTPS

## 🐛 Troubleshooting

### Common Issues
1. **API Key Invalid**: Kiểm tra lại API key
2. **Quota Exceeded**: Tăng quota hoặc đợi ngày mai
3. **Network Error**: Kiểm tra kết nối internet
4. **Extension Not Working**: Reload extension

### Debug Mode
```javascript
// Mở DevTools và chạy
console.log('Extension Debug Mode');
```

## 📈 Performance

### Optimizations
- **Parallel Loading**: Load nhiều data cùng lúc
- **Caching**: Cache model lists và settings
- **Lazy Loading**: Load data khi cần
- **Error Recovery**: Tự động khôi phục khi lỗi

### Benchmarks
- **Popup Load**: < 500ms
- **Model Selection**: < 200ms
- **Comment Generation**: < 10s
- **Settings Save**: < 100ms

## 🤝 Contributing

1. **Fork** repository
2. **Create** feature branch
3. **Commit** changes
4. **Push** to branch
5. **Create** Pull Request

## 📄 License

MIT License - xem file [LICENSE.md](LICENSE.md) để biết thêm chi tiết.

## 🙏 Acknowledgments

- **OpenAI** cho GPT models
- **Anthropic** cho Claude models
- **Google** cho Gemini models
- **Meta** cho Llama models
- **Mistral AI** cho Mistral models

---

**Made with ❤️ for Vietnamese users**

**Powered by Claude AI**
